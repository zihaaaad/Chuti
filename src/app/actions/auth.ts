'use server';

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { hashPassword, loginAdmin, logoutAdmin, revokeOtherSessions, verifyAdminPassword } from '@/lib/auth';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { ActionError, withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { setSetting } from '@/lib/settings';
import { singleton } from '@/lib/singleton';
import { passwordChangeSchema } from '@/lib/validation';

// Per-device login throttling. The app is shared over office Wi-Fi, so a
// single global failure counter would let any coworker lock the real admin
// out. Instead failures are keyed to an anonymous per-browser cookie.
const CLIENT_ID_COOKIE = 'chuti_client_id';
const MAX_FAILURES = 10;
const LOCK_MS = 5 * 60 * 1000;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

const attempts = singleton('login-attempts', () => new Map<string, { failures: number; lockedUntil: number; last: number }>());

async function clientId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CLIENT_ID_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const id = crypto.randomBytes(16).toString('hex');
  store.set(CLIENT_ID_COOKIE, id, {
    httpOnly: true,
    secure: process.env.APP_FORCE_HTTPS === 'true',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return id;
}

function prune(now: number) {
  for (const [key, entry] of attempts) {
    if (now - entry.last > ENTRY_TTL_MS) attempts.delete(key);
  }
  while (attempts.size > MAX_ENTRIES) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export async function handleLogin(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = await clientId();
  const now = Date.now();
  const entry = attempts.get(id);
  if (entry && entry.lockedUntil > now) {
    const minutes = Math.ceil((entry.lockedUntil - now) / 60000);
    return { success: false, error: `Too many incorrect passwords from this device. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` };
  }

  const password = formData.get('password');
  if (typeof password !== 'string' || password.length === 0) return { success: false, error: 'Enter the admin password.' };
  if (password.length > 100) return { success: false, error: 'Incorrect password.' };

  const ok = await loginAdmin(password);
  prune(now);
  const record = attempts.get(id) ?? { failures: 0, lockedUntil: 0, last: now };
  record.last = now;
  if (ok) {
    attempts.delete(id);
    return { success: true, data: undefined };
  }
  record.failures += 1;
  if (record.failures >= MAX_FAILURES) {
    record.failures = 0;
    record.lockedUntil = now + LOCK_MS;
  }
  attempts.set(id, record);
  return { success: false, error: 'Incorrect password.' };
}

export async function handleLogout() {
  await logoutAdmin();
  revalidatePath('/', 'layout');
  redirect('/');
}

/** Used both by the first-run setup screen and the Settings page. Signs out other browsers. */
export async function changeAdminPassword(formData: FormData): Promise<ActionResult> {
  return adminAction(
    'Could not change the password.',
    async () => {
      const input = parseInput(passwordChangeSchema, formData);
      if (!(await verifyAdminPassword(input.current_password))) {
        throw new ActionError('The current password is incorrect.');
      }
      const hash = await hashPassword(input.new_password);
      await withTransaction(async (db) => {
        await setSetting(db, 'admin_password_hash', hash);
        await setSetting(db, 'must_change_password', 'false');
        await logAudit(db, 'password_changed', 'auth', null, 'Admin password changed; other sessions signed out');
      });
      await revokeOtherSessions();
      revalidatePath('/', 'layout');
    },
    { allowPasswordChange: true },
  );
}
