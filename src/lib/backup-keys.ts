import 'server-only';
import bcrypt from 'bcryptjs';
import type { Database } from 'sqlite';
import { getDb, withTransaction } from './db';
import { logAudit } from './audit';
import { setSetting } from './settings';
import { singleton } from './singleton';
import {
  MIN_BACKUP_PASSWORD_LENGTH,
  createPasswordSlot,
  createRecoverySlot,
  generateMasterKey,
  generateRecoveryCode,
  unlockKeyRing,
  type KeyRing,
} from './backup-crypto';

// Backup encryption state.
//
// Stored in the database (and therefore inside every backup): only the
// protection mode and the key ring, whose slots are sealed by the backup
// password and the recovery code. Never stored in the database: the master key
// itself. The unlocked master key lives in server memory; on the desktop app
// the main process also keeps it DPAPI-protected outside the data folder and
// hands it back after a restart (see main.js), so scheduled copies keep running.

export type EncryptionMode = 'unset' | 'on' | 'off';

const KEYS = { mode: 'backup_encryption', ring: 'backup_key_ring' } as const;
export const ENCRYPTION_SETTING_KEYS = Object.values(KEYS);

const memory = singleton('backup-key', () => ({ keyId: null as string | null, key: null as Buffer | null }));

export interface EncryptionState {
  mode: EncryptionMode;
  keyId: string | null;
  ring: KeyRing | null;
  unlocked: boolean;
  /** Set by CHUTI_BACKUP_PASSWORD / CHUTI_BACKUP_ENCRYPTION when running from source. */
  envManaged: boolean;
}

export class BackupKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupKeyError';
  }
}

export async function readEncryptionState(db: Database): Promise<EncryptionState> {
  const rows = await db.all<{ key: string; value: string }[]>(
    'SELECT key, value FROM system_settings WHERE key IN (?, ?)',
    KEYS.mode,
    KEYS.ring,
  );
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const mode: EncryptionMode = v[KEYS.mode] === 'on' ? 'on' : v[KEYS.mode] === 'off' ? 'off' : 'unset';
  let ring: KeyRing | null = null;
  try {
    ring = v[KEYS.ring] ? (JSON.parse(v[KEYS.ring]) as KeyRing) : null;
  } catch {
    ring = null;
  }
  const keyId = mode === 'on' ? ring?.keyId ?? null : null;
  return {
    mode,
    keyId,
    ring: mode === 'on' ? ring : null,
    unlocked: !!keyId && memory.keyId === keyId && !!memory.key,
    envManaged: !!process.env.CHUTI_BACKUP_PASSWORD || process.env.CHUTI_BACKUP_ENCRYPTION === 'off',
  };
}

/** The unlocked master key, if it matches `keyId`. */
export function unlockedKey(keyId: string): Buffer | null {
  return memory.keyId === keyId && memory.key ? memory.key : null;
}

function remember(keyId: string, key: Buffer) {
  memory.keyId = keyId;
  memory.key = key;
}

export async function validateBackupPassword(db: Database, password: string): Promise<string | null> {
  if (typeof password !== 'string' || password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return `Use at least ${MIN_BACKUP_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.`;
  }
  if (password.length > 200) return 'Use 200 characters or fewer.';
  if (new Set(password).size < 5) return 'That password is too repetitive. Use a mix of words or characters.';
  const admin = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'admin_password_hash'");
  if (admin && (await bcrypt.compare(password, admin.value))) {
    return 'Do not reuse the admin password. Anyone who knows it could then open your backup copies.';
  }
  return null;
}

/** Turns protection on with a new master key. Returns the recovery code (shown once) and the key for the desktop key store. */
export async function enableEncryption(password: string): Promise<{ recoveryCode: string; keyId: string; key: Buffer }> {
  const db = await getDb();
  const problem = await validateBackupPassword(db, password);
  if (problem) throw new BackupKeyError(problem);
  const state = await readEncryptionState(db);
  if (state.mode === 'on') throw new BackupKeyError('Backup copies are already protected. Use “Change password” instead.');

  const { key, keyId } = generateMasterKey();
  const recoveryCode = generateRecoveryCode();
  const ring: KeyRing = { keyId, slots: [await createPasswordSlot(key, keyId, password), createRecoverySlot(key, keyId, recoveryCode)] };

  await withTransaction(async (tx) => {
    await setSetting(tx, KEYS.ring, JSON.stringify(ring));
    await setSetting(tx, KEYS.mode, 'on');
    await logAudit(tx, 'enabled', 'backup', keyId, 'Backup copies are now encrypted with a backup password (a recovery code was issued)');
  });
  remember(keyId, key);
  return { recoveryCode, keyId, key };
}

/** Re-seals the master key with a new password. The recovery code and existing copies keep working. */
export async function changeBackupPassword(currentSecret: string, newPassword: string): Promise<{ keyId: string; key: Buffer }> {
  const db = await getDb();
  const state = await readEncryptionState(db);
  if (state.mode !== 'on' || !state.ring) throw new BackupKeyError('Backup copies are not protected with a password.');
  const key = await unlockKeyRing(state.ring, currentSecret);
  if (!key) throw new BackupKeyError('The current backup password or recovery code is not correct.');
  const problem = await validateBackupPassword(db, newPassword);
  if (problem) throw new BackupKeyError(problem);

  const ring: KeyRing = {
    keyId: state.ring.keyId,
    slots: [await createPasswordSlot(key, state.ring.keyId, newPassword), ...state.ring.slots.filter((s) => s.type === 'recovery')],
  };
  await withTransaction(async (tx) => {
    await setSetting(tx, KEYS.ring, JSON.stringify(ring));
    await logAudit(tx, 'updated', 'backup', ring.keyId, 'Backup password changed; older copies still open with the old password or the recovery code');
  });
  remember(ring.keyId, key);
  return { keyId: ring.keyId, key };
}

export async function unlockEncryption(secret: string): Promise<{ keyId: string; key: Buffer }> {
  const db = await getDb();
  const state = await readEncryptionState(db);
  if (state.mode !== 'on' || !state.ring) throw new BackupKeyError('Backup copies are not protected with a password.');
  const key = await unlockKeyRing(state.ring, secret);
  if (!key) {
    await withTransaction((tx) => logAudit(tx, 'failed', 'backup', state.ring!.keyId, 'Wrong backup password or recovery code entered'));
    throw new BackupKeyError('That backup password or recovery code is not correct.');
  }
  remember(state.ring.keyId, key);
  return { keyId: state.ring.keyId, key };
}

/** Accepts a key previously stored by the desktop app, if it still belongs to the current key ring. */
export async function loadStoredKey(keyId: string, key: Buffer): Promise<boolean> {
  const state = await readEncryptionState(await getDb());
  if (state.mode !== 'on' || state.keyId !== keyId || key.length !== 32) return false;
  remember(keyId, key);
  return true;
}

/** Saves copies without encryption from now on. The key is forgotten; existing encrypted copies still need their password. */
export async function disableEncryption(): Promise<void> {
  await withTransaction(async (tx) => {
    await setSetting(tx, KEYS.mode, 'off');
    await setSetting(tx, KEYS.ring, '');
    await logAudit(tx, 'disabled', 'backup', null, 'Backup copies will be saved WITHOUT encryption');
  });
  memory.keyId = null;
  memory.key = null;
}

/**
 * Source/developer mode: CHUTI_BACKUP_PASSWORD enables or unlocks protection at
 * start-up (the recovery code is printed to the server console once);
 * CHUTI_BACKUP_ENCRYPTION=off records an explicit opt-out.
 */
export async function applyEnvironmentEncryption(): Promise<void> {
  const password = process.env.CHUTI_BACKUP_PASSWORD;
  const db = await getDb();
  const state = await readEncryptionState(db);
  if (password) {
    if (state.mode === 'on') {
      try {
        await unlockEncryption(password);
      } catch (err) {
        console.error('[backup-keys] CHUTI_BACKUP_PASSWORD does not unlock the backup key ring:', (err as Error).message);
      }
    } else {
      try {
        const { recoveryCode } = await enableEncryption(password);
        console.log(
          '\n==================== CHUTI BACKUP RECOVERY CODE ====================\n' +
            `  ${recoveryCode}\n` +
            '  Store this code somewhere safe and offline. It opens every encrypted\n' +
            '  backup copy if the backup password is lost. It will not be shown again.\n' +
            '====================================================================\n',
        );
      } catch (err) {
        console.error('[backup-keys] Could not enable backup encryption from CHUTI_BACKUP_PASSWORD:', (err as Error).message);
      }
    }
  } else if (process.env.CHUTI_BACKUP_ENCRYPTION === 'off' && state.mode === 'unset') {
    await withTransaction(async (tx) => {
      await setSetting(tx, KEYS.mode, 'off');
      await logAudit(tx, 'disabled', 'backup', null, 'Backup copies set to unencrypted by CHUTI_BACKUP_ENCRYPTION=off');
    });
  }
}
