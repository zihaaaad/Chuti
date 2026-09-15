import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-cloud-data-'));
process.env.APP_DATA_DIR = dataDir;

type Mods = {
  db: typeof import('./db');
  cloud: typeof import('./cloud-backup');
  keys: typeof import('./backup-keys');
  crypto: typeof import('./backup-crypto');
  restore: typeof import('./restore');
};
let m: Mods;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    cloud: await import('./cloud-backup'),
    keys: await import('./backup-keys'),
    crypto: await import('./backup-crypto'),
    restore: await import('./restore'),
  };
  const db = await m.db.getDb();
  await db.run("INSERT INTO departments (name) VALUES ('Science')");
  await db.run("INSERT INTO employees (name, employee_id, designation, department_id, join_date) VALUES ('Rahim', 'EMP-001', 'Lecturer', 1, '2026-01-01')");
});

afterAll(async () => {
  await m.db.withExclusiveAccess(() => m.db.closeDbUnlocked());
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('cloud backup', () => {
  it('never prepares an upload without encryption', async () => {
    await expect(m.cloud.prepareCloudUpload()).rejects.toThrow(/always encrypted/);
    const db = await m.db.getDb();
    await m.db.withTransaction((tx) => tx.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('backup_encryption', 'off')"));
    await expect(m.cloud.prepareCloudUpload()).rejects.toThrow(/always encrypted/);
    await m.db.withTransaction((tx) => tx.run("DELETE FROM system_settings WHERE key = 'backup_encryption'"));
    expect(fs.existsSync(m.cloud.cloudStagingDir()) ? fs.readdirSync(m.cloud.cloudStagingDir()) : []).toEqual([]);
    expect((await m.keys.readEncryptionState(db)).mode).toBe('unset');
  });

  it('prepares an encrypted archive in the local staging folder', async () => {
    await m.keys.enableEncryption('correct horse battery staple');
    const prepared = await m.cloud.prepareCloudUpload();
    expect(prepared.name).toMatch(/^Chuti-Backup_\d{4}-\d{2}-\d{2}_\d{6}\.chuti$/);
    expect(path.dirname(prepared.path)).toBe(m.cloud.cloudStagingDir());
    expect(path.dirname(prepared.path).startsWith(dataDir)).toBe(true);
    const header = await m.crypto.readEncryptedHeader(prepared.path);
    expect(header.keyId).toBeTruthy();
    // No plain archive or snapshot is left behind anywhere in the data folder.
    const leftovers = fs.readdirSync(dataDir).filter((f) => f.startsWith('.snapshot-') || f.startsWith('.backup-work-'));
    expect(leftovers).toEqual([]);
    expect(m.cloud.stagedArchivePath(prepared.name)).toBe(prepared.path);
  });

  it('resolves staged files by plain archive name only', () => {
    expect(m.cloud.stagedArchivePath('../database.db')).toBeNull();
    expect(m.cloud.stagedArchivePath('..\\Chuti-Backup_2026-09-15_190000.chuti')).toBeNull();
    expect(m.cloud.stagedArchivePath('Chuti-Backup_2026-09-15_190000.zip')).toBeNull();
    expect(m.cloud.stagedArchivePath('Chuti-Backup_1999-01-01_000000.chuti')).toBeNull(); // not staged
    expect(m.cloud.stagedArchivePath(42)).toBeNull();
  });

  it('records connections and results, and clears staging after a report', async () => {
    await m.cloud.recordCloudConnection('google', 'admin@example.com');
    let config = await m.cloud.readCloudConfig(await m.db.getDb());
    expect(config).toMatchObject({ provider: 'google', account: 'admin@example.com', lastSuccessAt: null });
    expect(m.cloud.isCloudBackupDue(config)).toBe(true);

    await m.cloud.recordCloudResult({ ok: true, trigger: 'manual', name: 'Chuti-Backup_2026-09-15_190000.chuti', size: 1234, pruned: 1 });
    config = await m.cloud.readCloudConfig(await m.db.getDb());
    expect(config.lastFile).toBe('Chuti-Backup_2026-09-15_190000.chuti');
    expect(m.cloud.cloudBackupHealth(config)).toBe('ok');
    expect(fs.existsSync(m.cloud.cloudStagingDir())).toBe(false);

    await m.cloud.recordCloudResult({ ok: false, trigger: 'scheduled', error: 'offline' });
    config = await m.cloud.readCloudConfig(await m.db.getDb());
    expect(m.cloud.cloudBackupHealth(config)).toBe('failing');

    const log = await (await m.db.getDb()).all<{ summary: string }[]>("SELECT summary FROM audit_log WHERE entity = 'backup' ORDER BY id");
    expect(log.map((l) => l.summary).join('\n')).toMatch(/Connected Google Drive \(admin@example\.com\)[\s\S]*uploaded to Google Drive/);
  });

  it('restores a staged cloud archive and keeps this computer’s cloud connection', async () => {
    const prepared = await m.cloud.prepareCloudUpload();
    const db = await m.db.getDb();
    await db.run("INSERT INTO employees (name, employee_id, designation, department_id, join_date) VALUES ('Karim', 'EMP-002', 'Clerk', 1, '2026-02-01')");
    await m.cloud.recordCloudConnection('onedrive', 'other@example.com');

    const result = await m.restore.restoreArchiveFile(prepared.path, prepared.name, undefined, 'cloud backup');
    expect(result.attachments).toBe(0);
    const names = (await (await m.db.getDb()).all<{ name: string }[]>('SELECT name FROM employees ORDER BY id')).map((e) => e.name);
    expect(names).toEqual(['Rahim']);
    const config = await m.cloud.readCloudConfig(await m.db.getDb());
    expect(config).toMatchObject({ provider: 'onedrive', account: 'other@example.com' });
  });

  it('disconnecting clears the account', async () => {
    await m.cloud.recordCloudConnection(null, null);
    const config = await m.cloud.readCloudConfig(await m.db.getDb());
    expect(config.provider).toBeNull();
    expect(m.cloud.cloudBackupHealth(config)).toBe('unset');
  });
});
