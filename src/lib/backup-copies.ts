import 'server-only';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { getDb, getPaths, withExclusiveAccess, withTransaction } from './db';
import { uploadsDir } from './attachments';
import { logAudit } from './audit';
import { setSetting } from './settings';
import { archiveFileName, listArchives, pruneArchives, writeArchive, type ArchiveInfo } from './archive';
import { encryptFile } from './backup-crypto';
import { applyEnvironmentEncryption, readEncryptionState, unlockedKey } from './backup-keys';
import { detectSyncProvider, type SyncProvider } from './sync-folders';
import { LATEST_SCHEMA_VERSION } from './migrations';
import { singleton } from './singleton';

// "Backup copies": full archives (database + attachments) written to a folder
// the admin chooses on their own computer — ideally a different drive, a USB
// stick, a NAS, or a Google Drive / OneDrive synced folder.
//
// The folder can only be chosen from the desktop app on the host computer
// (see /api/internal/backup-folder and main.js), or with the CHUTI_BACKUP_DIR
// environment variable when running from source. A LAN browser with the admin
// password can run, schedule, restore or stop copies, but cannot point them at
// a new location — otherwise it could copy the whole database to a share it controls.

export interface BackupCopyConfig {
  folder: string | null;
  source: 'desktop' | 'environment' | null;
  enabled: boolean;
  hour: number;
  keep: number;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSize: number | null;
  lastErrorAt: string | null;
  lastError: string | null;
  sameDriveAsData: boolean;
  folderReachable: boolean;
  /** Cloud service the backup folder syncs to, if any: files there leave this computer. */
  folderSync: SyncProvider | null;
  /** Cloud service Chuti's LIVE data folder syncs to, if any: the database itself is uploaded unencrypted. */
  dataFolderSync: SyncProvider | null;
}

const KEYS = {
  folder: 'backup_copy_folder',
  enabled: 'backup_copy_enabled',
  hour: 'backup_copy_hour',
  keep: 'backup_copy_keep',
  lastSuccessAt: 'backup_copy_last_success_at',
  lastFile: 'backup_copy_last_file',
  lastSize: 'backup_copy_last_size',
  lastErrorAt: 'backup_copy_last_error_at',
  lastError: 'backup_copy_last_error',
} as const;

/** Keys preserved across a restore, so restoring an old backup doesn't forget where copies go. */
export const BACKUP_COPY_SETTING_KEYS = Object.values(KEYS);

export async function readBackupCopyConfig(db: Database): Promise<BackupCopyConfig> {
  const rows = await db.all<{ key: string; value: string }[]>(
    `SELECT key, value FROM system_settings WHERE key IN (${BACKUP_COPY_SETTING_KEYS.map(() => '?').join(',')})`,
    ...BACKUP_COPY_SETTING_KEYS,
  );
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string | undefined>;

  const envFolder = process.env.CHUTI_BACKUP_DIR?.trim() || null;
  const folder = envFolder ?? (v[KEYS.folder] || null);
  const { DATA_DIR } = getPaths();

  return {
    folder,
    source: envFolder ? 'environment' : folder ? 'desktop' : null,
    enabled: v[KEYS.enabled] !== 'false',
    hour: clampInt(v[KEYS.hour], 0, 23, 18),
    keep: clampInt(v[KEYS.keep], 1, 365, 30),
    lastSuccessAt: v[KEYS.lastSuccessAt] || null,
    lastFile: v[KEYS.lastFile] || null,
    lastSize: v[KEYS.lastSize] ? Number(v[KEYS.lastSize]) : null,
    lastErrorAt: v[KEYS.lastErrorAt] || null,
    lastError: v[KEYS.lastError] || null,
    sameDriveAsData: !!folder && sameDrive(folder, DATA_DIR),
    folderReachable: !!folder && isWritableDir(folder),
    folderSync: folder ? detectSyncProvider(folder) : null,
    dataFolderSync: detectSyncProvider(DATA_DIR),
  };
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sameDrive(a: string, b: string): boolean {
  const root = (p: string) => path.parse(path.resolve(p)).root.toLowerCase();
  return root(a) === root(b);
}

export function isWritableDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Validates and stores a folder chosen in the desktop app. Returns a problem message or null. */
export async function setBackupCopyFolder(folder: string | null): Promise<string | null> {
  if (folder !== null) {
    if (!path.isAbsolute(folder)) return 'Choose a full folder path.';
    const resolved = path.resolve(folder);
    const { DATA_DIR, BACKUP_DIR } = getPaths();
    if (resolved === path.resolve(DATA_DIR) || resolved === path.resolve(BACKUP_DIR)) {
      return "Choose a folder outside Chuti's data folder.";
    }
    try {
      fs.mkdirSync(resolved, { recursive: true });
      const probe = path.join(resolved, `.chuti-write-test-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
    } catch {
      return 'Chuti cannot write to that folder. Check that the drive is connected and not read-only.';
    }
    folder = resolved;
  }
  await withTransaction(async (db) => {
    await setSetting(db, KEYS.folder, folder ?? '');
    if (folder) await setSetting(db, KEYS.enabled, 'true');
    await logAudit(db, folder ? 'updated' : 'cleared', 'backup', null, folder ? `Backup copies will be saved to ${folder}` : 'Stopped saving backup copies to a folder');
  });
  return null;
}

export async function setBackupCopySchedule(db: Database, schedule: { enabled: boolean; hour: number; keep: number }) {
  await setSetting(db, KEYS.enabled, String(schedule.enabled));
  await setSetting(db, KEYS.hour, String(schedule.hour));
  await setSetting(db, KEYS.keep, String(schedule.keep));
}

export function listBackupCopies(config: BackupCopyConfig): ArchiveInfo[] {
  return config.folder && config.folderReachable ? listArchives(config.folder) : [];
}

const jobs = singleton('backup-copies', () => ({
  running: null as Promise<BackupCopyResult> | null,
  schedulerStarted: false,
}));

export interface BackupCopyResult {
  ok: boolean;
  name?: string;
  size?: number;
  attachments?: number;
  pruned?: number;
  encrypted?: boolean;
  error?: string;
}

/**
 * Creates one archive in the configured folder. Concurrent calls share the
 * same run. Never throws: failures are recorded in settings for the health banner.
 */
export function runBackupCopy(trigger: 'manual' | 'scheduled'): Promise<BackupCopyResult> {
  if (!jobs.running) {
    jobs.running = doRun(trigger).finally(() => {
      jobs.running = null;
    });
  }
  return jobs.running;
}

export interface BuiltArchive {
  name: string;
  path: string;
  size: number;
  attachments: number;
  encrypted: boolean;
}

/**
 * Writes one full archive (database snapshot + attachments) into `targetDir`,
 * encrypted when backup encryption is on. Plain intermediate files stay inside
 * the local data folder. With `requireEncryption`, refuses to write a plain archive.
 */
export async function createBackupArchive(options: { targetDir: string; requireEncryption?: boolean }): Promise<BuiltArchive> {
  const db = await getDb();
  const { DATA_DIR } = getPaths();
  const { targetDir } = options;
  const stamp = Date.now();
  const snapshot = path.join(DATA_DIR, `.snapshot-${stamp}.db`);
  // Plain archives for encrypted copies are built here, inside the local data
  // folder, and never in the target folder: a sync client could upload them.
  const workDir = path.join(DATA_DIR, `.backup-work-${stamp}`);
  try {
    const encryption = await readEncryptionState(db);
    if (options.requireEncryption && encryption.mode !== 'on') {
      throw new Error('Cloud backups are always encrypted. Set a backup password first (Settings → Backup copies).');
    }
    if (encryption.mode === 'unset') {
      throw new Error('Choose how backup copies are protected (Settings → Backup copies) before Chuti saves any.');
    }
    const masterKey = encryption.mode === 'on' && encryption.keyId ? unlockedKey(encryption.keyId) : null;
    if (encryption.mode === 'on' && (!masterKey || !encryption.ring)) {
      throw new Error('Backups are locked: enter the backup password in Settings → Backup copies on the Chuti computer.');
    }

    // VACUUM INTO writes a consistent, compact copy without the WAL. Hold the
    // write lock so no transaction is half-applied in the snapshot.
    await withExclusiveAccess(() => db.run('VACUUM INTO ?', snapshot));
    await scrubSnapshot(snapshot);

    const [employees, leaveRecords, settings] = await Promise.all([
      db.get<{ c: number }>('SELECT COUNT(*) AS c FROM employees'),
      db.get<{ c: number }>('SELECT COUNT(*) AS c FROM leave_records'),
      db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'institute_name'"),
    ]);

    // Names are timestamped to the second. Never reuse a timestamp that already
    // exists in either format, or a quick second copy would overwrite the first.
    let now = new Date();
    while (['zip', 'chuti'].some((ext) => fs.existsSync(path.join(targetDir, archiveFileName(now, ext as 'zip' | 'chuti'))))) {
      await new Promise((r) => setTimeout(r, 250));
      now = new Date();
    }
    const archive = await writeArchive({
      databaseSnapshot: snapshot,
      uploadsDir: uploadsDir(),
      targetDir: masterKey ? workDir : targetDir,
      now,
      meta: {
        appVersion: process.env.CHUTI_APP_VERSION || 'source',
        schemaVersion: LATEST_SCHEMA_VERSION,
        organisation: settings?.value ?? '',
        counts: { employees: employees?.c ?? 0, leaveRecords: leaveRecords?.c ?? 0 },
      },
    });
    const attachments = archive.manifest.counts.attachments;

    if (masterKey && encryption.ring) {
      const name = archiveFileName(now, 'chuti');
      const finalPath = path.join(targetDir, name);
      const partial = `${finalPath}.partial`;
      try {
        await encryptFile(path.join(workDir, archive.name), partial, masterKey, encryption.ring, now);
        fs.renameSync(partial, finalPath);
      } catch (err) {
        fs.rmSync(partial, { force: true });
        throw err;
      }
      return { name, path: finalPath, size: fs.statSync(finalPath).size, attachments, encrypted: true };
    }
    return { name: archive.name, path: path.join(targetDir, archive.name), size: archive.size, attachments, encrypted: false };
  } finally {
    fs.rmSync(snapshot, { force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function doRun(trigger: 'manual' | 'scheduled'): Promise<BackupCopyResult> {
  const db = await getDb();
  const config = await readBackupCopyConfig(db);
  if (!config.folder) return { ok: false, error: 'No backup folder has been chosen.' };

  try {
    if (!config.folderReachable) {
      throw new Error(`The backup folder is not available: ${config.folder}. Reconnect the drive or choose another folder.`);
    }
    const result = await createBackupArchive({ targetDir: config.folder });
    const pruned = pruneArchives(config.folder, config.keep);

    await withTransaction(async (tx) => {
      await setSetting(tx, KEYS.lastSuccessAt, new Date().toISOString());
      await setSetting(tx, KEYS.lastFile, result.name);
      await setSetting(tx, KEYS.lastSize, String(result.size));
      await setSetting(tx, KEYS.lastError, '');
      await setSetting(tx, KEYS.lastErrorAt, '');
      await logAudit(tx, 'created', 'backup', result.name,
        `${trigger === 'manual' ? 'Manual' : 'Scheduled'} ${result.encrypted ? 'encrypted' : 'UNENCRYPTED'} backup copy ${result.name} (${result.attachments} attachments)${pruned.length ? `; removed ${pruned.length} old cop${pruned.length === 1 ? 'y' : 'ies'}` : ''}`);
    });
    return { ok: true, name: result.name, size: result.size, attachments: result.attachments, pruned: pruned.length, encrypted: result.encrypted };
  } catch (err) {
    const message = (err as Error).message || 'Unknown error';
    console.error('[backup-copy] failed:', err);
    try {
      await withTransaction(async (tx) => {
        await setSetting(tx, KEYS.lastError, message.slice(0, 300));
        await setSetting(tx, KEYS.lastErrorAt, new Date().toISOString());
      });
    } catch {
      // Recording the failure must not mask it.
    }
    return { ok: false, error: message };
  }
}

/**
 * Removes data a backup copy never needs: sign-in sessions. The second VACUUM
 * rewrites the file so the deleted rows don't linger in free pages.
 */
export async function scrubSnapshot(file: string): Promise<void> {
  const snap = await open({ filename: file, driver: sqlite3.Database });
  try {
    await snap.exec('DELETE FROM admin_sessions');
    await snap.exec('VACUUM');
  } finally {
    await snap.close();
  }
}

/** True when the configured daily time has passed today and no copy has succeeded since then. */
export function isBackupCopyDue(config: BackupCopyConfig, now: Date = new Date()): boolean {
  if (!config.folder || !config.enabled) return false;
  const dueAt = new Date(now);
  dueAt.setHours(config.hour, 0, 0, 0);
  if (now < dueAt) dueAt.setDate(dueAt.getDate() - 1);
  const last = config.lastSuccessAt ? new Date(config.lastSuccessAt) : null;
  if (last && last >= dueAt) return false;
  // After a failure, wait an hour before retrying so an unplugged drive doesn't spin.
  const lastError = config.lastErrorAt ? new Date(config.lastErrorAt) : null;
  if (lastError && now.getTime() - lastError.getTime() < 60 * 60 * 1000) return false;
  return true;
}

/** Copies are overdue when enabled and the last success is more than 48 hours old (or never). */
export function backupCopyHealth(config: BackupCopyConfig, now: Date = new Date()): 'ok' | 'overdue' | 'failing' | 'off' | 'unset' {
  if (!config.folder) return 'unset';
  if (!config.enabled) return 'off';
  const lastSuccess = config.lastSuccessAt ? new Date(config.lastSuccessAt).getTime() : 0;
  const lastError = config.lastErrorAt ? new Date(config.lastErrorAt).getTime() : 0;
  if (lastError > lastSuccess) return 'failing';
  if (now.getTime() - lastSuccess > 48 * 60 * 60 * 1000) return 'overdue';
  return 'ok';
}

/** Checks every 10 minutes whether a scheduled copy is due. Started once from instrumentation.ts. */
export function startBackupCopyScheduler() {
  if (jobs.schedulerStarted) return;
  jobs.schedulerStarted = true;
  applyEnvironmentEncryption().catch((err) => console.error('[backup-keys] environment setup failed:', err));
  const tick = async () => {
    try {
      const config = await readBackupCopyConfig(await getDb());
      if (isBackupCopyDue(config)) await runBackupCopy('scheduled');
    } catch (err) {
      console.error('[backup-copy] scheduler tick failed:', err);
    }
  };
  setTimeout(() => void tick(), 60 * 1000).unref?.();
  setInterval(() => void tick(), 10 * 60 * 1000).unref?.();
}
