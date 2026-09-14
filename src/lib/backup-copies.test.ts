import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BackupCopyConfig } from './backup-copies';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-copy-data-'));
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-copy-target-'));
process.env.APP_DATA_DIR = dataDir;
process.env.CHUTI_BACKUP_DIR = copyDir;

type Mods = { db: typeof import('./db'); copies: typeof import('./backup-copies'); archive: typeof import('./archive') };
let m: Mods;

beforeAll(async () => {
  m = { db: await import('./db'), copies: await import('./backup-copies'), archive: await import('./archive') };
  const db = await m.db.getDb(); // runs migrations on a fresh database
  await db.run("INSERT INTO departments (name) VALUES ('Science')");
  await db.run("INSERT INTO employees (name, employee_id, designation, department_id, join_date) VALUES ('Rahim', 'EMP-001', 'Lecturer', 1, '2026-01-01')");
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'uploads', '1_note.pdf'), 'pdf-bytes');
});

afterAll(async () => {
  await m.db.withExclusiveAccess(() => m.db.closeDbUnlocked());
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(copyDir, { recursive: true, force: true });
});

const base: BackupCopyConfig = {
  folder: 'D:\\ChutiCopies', source: 'desktop', enabled: true, hour: 18, keep: 30,
  lastSuccessAt: null, lastFile: null, lastSize: null, lastErrorAt: null, lastError: null,
  sameDriveAsData: false, folderReachable: true, folderSync: null, dataFolderSync: null,
};

describe('schedule and health', () => {
  it('is due after the daily time when nothing succeeded since then', () => {
    const now = new Date(2026, 8, 14, 19, 0);
    expect(m.copies.isBackupCopyDue({ ...base, lastSuccessAt: new Date(2026, 8, 13, 18, 5).toISOString() }, now)).toBe(true);
    expect(m.copies.isBackupCopyDue({ ...base, lastSuccessAt: new Date(2026, 8, 14, 18, 5).toISOString() }, now)).toBe(false);
  });

  it("before today's time, only yesterday's slot counts", () => {
    const now = new Date(2026, 8, 14, 9, 0);
    expect(m.copies.isBackupCopyDue({ ...base, lastSuccessAt: new Date(2026, 8, 13, 18, 30).toISOString() }, now)).toBe(false);
    expect(m.copies.isBackupCopyDue({ ...base, lastSuccessAt: new Date(2026, 8, 12, 18, 30).toISOString() }, now)).toBe(true);
  });

  it('waits an hour after a failure and never runs when off or unset', () => {
    const now = new Date(2026, 8, 14, 19, 0);
    expect(m.copies.isBackupCopyDue({ ...base, lastErrorAt: new Date(2026, 8, 14, 18, 30).toISOString() }, now)).toBe(false);
    expect(m.copies.isBackupCopyDue({ ...base, enabled: false }, now)).toBe(false);
    expect(m.copies.isBackupCopyDue({ ...base, folder: null }, now)).toBe(false);
  });

  it('reports health', () => {
    const now = new Date(2026, 8, 14, 12, 0);
    expect(m.copies.backupCopyHealth({ ...base, folder: null }, now)).toBe('unset');
    expect(m.copies.backupCopyHealth({ ...base, lastSuccessAt: new Date(2026, 8, 14, 1).toISOString() }, now)).toBe('ok');
    expect(m.copies.backupCopyHealth({ ...base, lastSuccessAt: new Date(2026, 8, 11).toISOString() }, now)).toBe('overdue');
    expect(m.copies.backupCopyHealth({ ...base, lastSuccessAt: new Date(2026, 8, 13).toISOString(), lastErrorAt: new Date(2026, 8, 14).toISOString() }, now)).toBe('failing');
  });
});

describe('runBackupCopy', () => {
  it('refuses to save anything until protection has been chosen', async () => {
    const result = await m.copies.runBackupCopy('scheduled');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Choose how backup copies are protected/);
    expect(m.archive.listArchives(copyDir)).toHaveLength(0);
  });

  it('writes a verified archive with the live database and attachments, and records success', async () => {
    const db = await m.db.getDb();
    await m.db.withTransaction((tx) => tx.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('backup_encryption', 'off')"));
    await db.run("INSERT INTO admin_sessions (session_id) VALUES ('a-live-session-hash')");
    const result = await m.copies.runBackupCopy('manual');
    expect(result.ok).toBe(true);
    expect(result.attachments).toBe(1);

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-copy-out-'));
    try {
      const manifest = await m.archive.extractArchive(path.join(copyDir, result.name!), out);
      expect(manifest.counts.employees).toBe(1);
      expect(fs.readFileSync(path.join(out, 'uploads', '1_note.pdf'), 'utf8')).toBe('pdf-bytes');

      // The snapshot is a real, openable SQLite database with the data in it.
      const sqlite3 = (await import('sqlite3')).default;
      const { open } = await import('sqlite');
      const snap = await open({ filename: path.join(out, 'database.db'), driver: sqlite3.Database });
      expect((await snap.get("SELECT name FROM employees WHERE employee_id = 'EMP-001'"))?.name).toBe('Rahim');
      // Sign-in sessions never leave the computer inside a backup copy.
      expect((await snap.get('SELECT COUNT(*) AS c FROM admin_sessions'))?.c).toBe(0);
      await snap.close();
      const raw = fs.readFileSync(path.join(out, 'database.db'));
      expect(raw.includes(Buffer.from('a-live-session-hash'))).toBe(false);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }

    const config = await m.copies.readBackupCopyConfig(await m.db.getDb());
    expect(config.source).toBe('environment');
    expect(config.lastFile).toBe(result.name);
    expect(m.copies.backupCopyHealth(config)).toBe('ok');
    expect(fs.readdirSync(dataDir).some((f) => f.startsWith('.snapshot-'))).toBe(false);
  });

  it('prunes old copies beyond the keep limit', async () => {
    const db = await m.db.getDb();
    await m.db.withTransaction((tx) => m.copies.setBackupCopySchedule(tx, { enabled: true, hour: 18, keep: 2 }));
    for (const d of [1, 2, 3]) fs.writeFileSync(path.join(copyDir, m.archive.archiveFileName(new Date(2020, 0, d))), 'old');
    const result = await m.copies.runBackupCopy('manual');
    expect(result.ok).toBe(true);
    expect(m.archive.listArchives(copyDir)).toHaveLength(2);
    expect((await m.copies.readBackupCopyConfig(db)).keep).toBe(2);
  });

  it('writes encrypted copies that only the key, the password or the recovery code can open', async () => {
    const keys = await import('./backup-keys');
    const crypto = await import('./backup-crypto');
    await m.db.withTransaction((tx) => tx.run("UPDATE system_settings SET value = 'unset' WHERE key = 'backup_encryption'"));

    const password = 'staff room kettle 2026';
    const { recoveryCode, keyId } = await keys.enableEncryption(password);
    const result = await m.copies.runBackupCopy('manual');
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(true);
    expect(result.name).toMatch(/\.chuti$/);

    const file = path.join(copyDir, result.name!);
    const raw = fs.readFileSync(file);
    expect(raw.includes(Buffer.from('pdf-bytes'))).toBe(false);
    expect(raw.includes(Buffer.from('Rahim'))).toBe(false);
    // No plaintext zip was ever placed in the backup folder or left in the data folder.
    expect(fs.existsSync(path.join(copyDir, result.name!.replace(/\.chuti$/, '.zip')))).toBe(false);
    expect(fs.readdirSync(copyDir).some((f) => f.endsWith('.partial'))).toBe(false);
    expect(fs.readdirSync(dataDir).some((f) => f.startsWith('.backup-work-'))).toBe(false);

    const header = await crypto.readEncryptedHeader(file);
    expect(header.keyId).toBe(keyId);
    for (const secret of [password, recoveryCode]) {
      const key = await crypto.unlockKeyRing({ keyId: header.keyId, slots: header.slots }, secret);
      expect(key).not.toBeNull();
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-copy-dec-'));
      try {
        await crypto.decryptFile(file, path.join(out, 'archive.zip'), key!);
        const manifest = await m.archive.extractArchive(path.join(out, 'archive.zip'), path.join(out, 'x'));
        expect(manifest.counts.attachments).toBe(1);
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    }
    expect(await crypto.unlockKeyRing({ keyId: header.keyId, slots: header.slots }, 'not the password at all')).toBeNull();

    // The master key never appears in the database (which is itself inside every backup).
    const ringJson = (await (await m.db.getDb()).get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'backup_key_ring'"))!.value;
    expect(ringJson).not.toContain(keys.unlockedKey(keyId)!.toString('base64'));
  }, 60_000);

  it('keeps copies locked after a restart until the key is supplied again', async () => {
    const keys = await import('./backup-keys');
    const state = await keys.readEncryptionState(await m.db.getDb());
    const key = keys.unlockedKey(state.keyId!)!;

    // Simulate a restart: the in-memory key is gone.
    (globalThis as unknown as { __chuti: Record<string, { keyId: string | null; key: Buffer | null }> }).__chuti['backup-key'].key = null;
    const locked = await m.copies.runBackupCopy('scheduled');
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/locked/);

    // The desktop app re-arms the key it stored with DPAPI; a key from another ring is refused.
    expect(await keys.loadStoredKey('0000000000000000', key)).toBe(false);
    expect(await keys.loadStoredKey(state.keyId!, key)).toBe(true);
    expect((await m.copies.runBackupCopy('manual')).ok).toBe(true);
  }, 60_000);

  it('rejects weak or reused backup passwords', async () => {
    const keys = await import('./backup-keys');
    const db = await m.db.getDb();
    expect(await keys.validateBackupPassword(db, 'short')).toMatch(/at least 12/);
    expect(await keys.validateBackupPassword(db, 'aaaaaaaaaaaaaaaa')).toMatch(/repetitive/);
    // Migration seeds admin123 as the admin password; reusing it is refused.
    expect(await keys.validateBackupPassword(db, 'admin123admin123')).toBeNull();
    const bcrypt = (await import('bcryptjs')).default;
    await m.db.withTransaction((tx) => tx.run("UPDATE system_settings SET value = ? WHERE key = 'admin_password_hash'", bcrypt.hashSync('Principal-Office-99', 4)));
    expect(await keys.validateBackupPassword(db, 'Principal-Office-99')).toMatch(/admin password/);
  });

  it('records a failure when the folder is missing', async () => {
    process.env.CHUTI_BACKUP_DIR = path.join(copyDir, 'unplugged-usb-drive');
    try {
      const result = await m.copies.runBackupCopy('scheduled');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not available/);
      expect(m.copies.backupCopyHealth(await m.copies.readBackupCopyConfig(await m.db.getDb()))).toBe('failing');
    } finally {
      process.env.CHUTI_BACKUP_DIR = copyDir;
    }
  });
});
