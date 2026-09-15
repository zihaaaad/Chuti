import 'server-only';
import fs from 'fs';
import path from 'path';
import { verifyChutiDatabase } from './sqlite-verify';
import { ActionError, checkpointedBackup, copyWithSidecars, getDb, getPaths, swapDatabaseFile, withTransaction } from './db';
import { logAudit } from './audit';
import { uploadsDir } from './attachments';
import { ArchiveError, extractArchive } from './archive';
import { BackupCryptoError, decryptFile, readEncryptedHeader, unlockKeyRing } from './backup-crypto';
import { ENCRYPTION_SETTING_KEYS, unlockedKey } from './backup-keys';
import { BACKUP_COPY_SETTING_KEYS } from './backup-copies';
import { CLOUD_SETTING_KEYS } from './cloud-backup';
import { LATEST_SCHEMA_VERSION } from './migrations';
import { setSetting } from './settings';

// Restoring data: shared by quick restore points, backup copies in a folder,
// and backups downloaded from a cloud account.

/**
 * Replaces the live database with `sourceDb` (plus sidecars, if any):
 * verifies it first, saves a pre-restore copy, and keeps the backup-copy folder
 * settings so a restore never silently changes where future copies go.
 */
export async function replaceDatabase(sourceDb: string) {
  const { DB_PATH, DATA_DIR } = getPaths();

  // Verify a scratch copy (with its WAL) so a damaged file is rejected before anything is touched.
  const scratch = path.join(DATA_DIR, `.verify_${Date.now()}.db`);
  copyWithSidecars(sourceDb, scratch);
  try {
    const verified = await verifyChutiDatabase(scratch);
    if (!verified.ok) throw new ActionError(verified.problem);
    if (verified.schemaVersion > LATEST_SCHEMA_VERSION) {
      throw new ActionError('That backup was made by a newer version of Chuti. Update Chuti, then restore it.');
    }
  } finally {
    for (const s of ['', '-wal', '-shm']) fs.rmSync(scratch + s, { force: true });
  }

  const liveDb = await getDb();
  // Where copies go and how they are protected belong to this computer, not to
  // the backup: restoring a copy made before encryption was turned on must not
  // silently switch protection off.
  const preservedKeys = [...BACKUP_COPY_SETTING_KEYS, ...ENCRYPTION_SETTING_KEYS, ...CLOUD_SETTING_KEYS];
  const keep = await liveDb.all<{ key: string; value: string }[]>(
    `SELECT key, value FROM system_settings WHERE key IN (${preservedKeys.map(() => '?').join(',')})`,
    ...preservedKeys,
  );
  // Current sign-ins survive the restore; sessions inside the backup do not.
  const sessions = await liveDb.all<{ session_id: string; created_at: string }[]>('SELECT session_id, created_at FROM admin_sessions');

  if (!(await checkpointedBackup('prerestore'))) {
    throw new ActionError('A safety copy of the current data could not be saved, so nothing was restored.');
  }
  await swapDatabaseFile(() => copyWithSidecars(sourceDb, DB_PATH));

  await withTransaction(async (db) => {
    for (const { key, value } of keep) await setSetting(db, key, value);
    await db.run('DELETE FROM admin_sessions');
    for (const s of sessions) {
      await db.run('INSERT OR IGNORE INTO admin_sessions (session_id, created_at) VALUES (?, ?)', s.session_id, s.created_at);
    }
  });
}

/**
 * Restores a full archive (`.zip` or encrypted `.chuti`): decrypts with the key
 * unlocked on this computer or with `secret`, verifies every checksum, replaces
 * the database and puts attachments back. Throws ActionError with code
 * SECRET_REQUIRED when a password or recovery code is needed.
 */
export async function restoreArchiveFile(archivePath: string, name: string, secret: string | undefined, label: string): Promise<{ attachments: number }> {
  if (secret !== undefined && (typeof secret !== 'string' || secret.length > 200)) throw new ActionError('Invalid password.');

  const { DATA_DIR } = getPaths();
  const workDir = path.join(DATA_DIR, `.restore-${Date.now()}`);
  try {
    let zipPath = archivePath;
    if (name.endsWith('.chuti')) {
      fs.mkdirSync(workDir, { recursive: true });
      zipPath = path.join(workDir, 'archive.zip');
      let header;
      try {
        header = await readEncryptedHeader(archivePath);
      } catch (err) {
        throw new ActionError(err instanceof BackupCryptoError ? err.message : 'This backup is damaged.');
      }
      // Use the key already unlocked on this computer when it matches; otherwise the copy's own key slots.
      let key = unlockedKey(header.keyId);
      if (!key) {
        if (!secret) {
          throw new ActionError('This copy is encrypted. Enter its backup password or recovery code.', 'SECRET_REQUIRED');
        }
        key = await unlockKeyRing({ keyId: header.keyId, slots: header.slots }, secret);
        if (!key) {
          await withTransaction((db) => logAudit(db, 'failed', 'backup', name, `Wrong backup password or recovery code for ${name}`));
          throw new ActionError('That password or recovery code does not open this copy. Copies made before a password change need the old password.', 'SECRET_REQUIRED');
        }
      }
      try {
        await decryptFile(archivePath, zipPath, key);
      } catch (err) {
        throw new ActionError(err instanceof BackupCryptoError ? err.message : 'This backup could not be decrypted.');
      }
    }

    let manifest;
    try {
      manifest = await extractArchive(zipPath, workDir);
    } catch (err) {
      if (err instanceof ArchiveError) throw new ActionError(err.message);
      throw err;
    }
    if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) {
      throw new ActionError('That backup was made by a newer version of Chuti. Update Chuti, then restore it.');
    }

    await replaceDatabase(path.join(workDir, 'database.db'));

    // Put attachments back. Existing files with the same name are replaced; extra files are left alone.
    const target = uploadsDir();
    fs.mkdirSync(target, { recursive: true });
    const restoredUploads = path.join(workDir, 'uploads');
    const files = fs.existsSync(restoredUploads) ? fs.readdirSync(restoredUploads) : [];
    for (const f of files) fs.copyFileSync(path.join(restoredUploads, f), path.join(target, f));

    await withTransaction((db) =>
      logAudit(db, 'restored', 'backup', name, `Restored from ${label} ${name} (made ${new Date(manifest.createdAt).toLocaleString('en-GB')}, ${files.length} attachments)`),
    );
    return { attachments: files.length };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
