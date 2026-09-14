import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb, withTransaction } from './db';

const COOKIE_NAME = 'chuti_session';
export const SESSION_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Sessions are stored as SHA-256 hashes of the cookie token. The database, its
 * restore points and backup copies therefore never contain a token that could
 * be replayed as a cookie by someone who obtains a copy of the file.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface Session {
  mustChangePassword: boolean;
}

/**
 * The session for this request, or null. Checked against the database and the
 * 7-day lifetime on every call site (memoized per request), per the Next.js
 * guidance to authorize next to the data rather than only in a layout.
 */
export const verifySession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT session_id FROM admin_sessions WHERE session_id = ? AND created_at >= datetime('now', ?)`,
      hashSessionToken(token),
      `-${SESSION_DAYS} days`,
    );
    if (!row) return null;
    const flag = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'must_change_password'");
    return { mustChangePassword: flag?.value === 'true' };
  } catch (err) {
    console.error('Session verification error:', err);
    return null;
  }
});

/** For Server Components: redirect away unless fully signed in. */
export async function requireAdmin(options: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const session = await verifySession();
  if (!session) redirect('/');
  if (session.mustChangePassword && !options.allowPasswordChange) redirect('/setup');
  return session;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await verifySession()) !== null;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'admin_password_hash'");
  return !!row && (await bcrypt.compare(password, row.value));
}

export async function loginAdmin(password: string): Promise<boolean> {
  if (!(await verifyAdminPassword(password))) return false;

  const token = crypto.randomBytes(32).toString('hex');
  await withTransaction(async (db) => {
    await db.run("DELETE FROM admin_sessions WHERE created_at < datetime('now', ?)", `-${SESSION_DAYS} days`);
    await db.run('INSERT INTO admin_sessions (session_id) VALUES (?)', hashSessionToken(token));
  });

  // The app is served over plain HTTP on localhost/LAN, where a `Secure`
  // cookie would be dropped. Only set it when deployed behind HTTPS.
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.APP_FORCE_HTTPS === 'true',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: '/',
  });
  return true;
}

export async function logoutAdmin(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    try {
      await withTransaction((db) => db.run('DELETE FROM admin_sessions WHERE session_id = ?', hashSessionToken(token)));
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  }
  store.delete(COOKIE_NAME);
}

/** Signs out every other browser — used after a password change. */
export async function revokeOtherSessions(): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? '';
  await withTransaction((db) => db.run('DELETE FROM admin_sessions WHERE session_id != ?', hashSessionToken(token)));
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
