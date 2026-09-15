import 'server-only';
import fs from 'fs';
import path from 'path';
import type { Database } from 'sqlite';
import { getDb, getPaths, withTransaction } from './db';
import { logAudit } from './audit';
import { setSetting } from './settings';
import { isArchiveName } from './archive';
import { createBackupArchive } from './backup-copies';
import { singleton } from './singleton';

// Cloud backup (Google Drive, OneDrive). The account connection, its tokens and
// the uploads live in the Electron main process on the host computer (see
// electron/cloud). The database only records which account is connected, the
// schedule and the outcome of each run, for display and the health banner.
// This module prepares encrypted archives for upload and receives the results.

export const CLOUD_PROVIDERS = ['google', 'onedrive'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = { google: 'Google Drive', onedrive: 'OneDrive' };

export interface CloudBackupConfig {
  provider: CloudProvider | null;
  account: string | null;
  enabled: boolean;
  hour: number;
  keep: number;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSize: number | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const KEYS = {
  provider: 'cloud_provider',
  account: 'cloud_account',
  enabled: 'cloud_enabled',
  hour: 'cloud_hour',
  keep: 'cloud_keep',
  lastSuccessAt: 'cloud_last_success_at',
  lastFile: 'cloud_last_file',
  lastSize: 'cloud_last_size',
  lastErrorAt: 'cloud_last_error_at',
  lastError: 'cloud_last_error',
} as const;

/** Preserved across a restore: the cloud connection belongs to this computer, not to the backup. */
export const CLOUD_SETTING_KEYS = Object.values(KEYS);

export function isCloudProvider(value: unknown): value is CloudProvider {
  return typeof value === 'string' && (CLOUD_PROVIDERS as readonly string[]).includes(value);
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function readCloudConfig(db: Database): Promise<CloudBackupConfig> {
  const rows = await db.all<{ key: string; value: string }[]>(
    `SELECT key, value FROM system_settings WHERE key IN (${CLOUD_SETTING_KEYS.map(() => '?').join(',')})`,
    ...CLOUD_SETTING_KEYS,
  );
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string | undefined>;
  const rawProvider = v[KEYS.provider];
  const provider = isCloudProvider(rawProvider) ? rawProvider : null;
  return {
    provider,
    account: provider ? v[KEYS.account] || null : null,
    enabled: v[KEYS.enabled] !== 'false',
    hour: clampInt(v[KEYS.hour], 0, 23, 19),
    keep: clampInt(v[KEYS.keep], 1, 365, 30),
    lastSuccessAt: v[KEYS.lastSuccessAt] || null,
    lastFile: v[KEYS.lastFile] || null,
    lastSize: v[KEYS.lastSize] ? Number(v[KEYS.lastSize]) : null,
    lastErrorAt: v[KEYS.lastErrorAt] || null,
    lastError: v[KEYS.lastError] || null,
  };
}

export async function setCloudSchedule(db: Database, schedule: { enabled: boolean; hour: number; keep: number }) {
  await setSetting(db, KEYS.enabled, String(schedule.enabled));
  await setSetting(db, KEYS.hour, String(schedule.hour));
  await setSetting(db, KEYS.keep, String(schedule.keep));
}

/** Due once the daily hour has passed without a success, with an hour's pause after a failure. */
export function isCloudBackupDue(config: CloudBackupConfig, now: Date = new Date()): boolean {
  if (!config.provider || !config.enabled) return false;
  const dueAt = new Date(now);
  dueAt.setHours(config.hour, 0, 0, 0);
  if (now < dueAt) dueAt.setDate(dueAt.getDate() - 1);
  const last = config.lastSuccessAt ? new Date(config.lastSuccessAt) : null;
  if (last && last >= dueAt) return false;
  const lastError = config.lastErrorAt ? new Date(config.lastErrorAt) : null;
  if (lastError && now.getTime() - lastError.getTime() < 60 * 60 * 1000) return false;
  return true;
}

export function cloudBackupHealth(config: CloudBackupConfig, now: Date = new Date()): 'ok' | 'overdue' | 'failing' | 'off' | 'unset' {
  if (!config.provider) return 'unset';
  if (!config.enabled) return 'off';
  const lastSuccess = config.lastSuccessAt ? new Date(config.lastSuccessAt).getTime() : 0;
  const lastError = config.lastErrorAt ? new Date(config.lastErrorAt).getTime() : 0;
  if (lastError > lastSuccess) return 'failing';
  if (now.getTime() - lastSuccess > 48 * 60 * 60 * 1000) return 'overdue';
  return 'ok';
}

// ─── Staging: encrypted files waiting to be uploaded, or just downloaded ──────

/** Inside the local data folder, never a synced folder. Cleared around every run. */
export function cloudStagingDir(): string {
  return path.join(getPaths().DATA_DIR, '.cloud-staging');
}

/** Resolves a staged archive by name, refusing anything but a plain encrypted archive file name. */
export function stagedArchivePath(name: unknown): string | null {
  if (typeof name !== 'string' || path.basename(name) !== name || !isArchiveName(name) || !name.endsWith('.chuti')) return null;
  const file = path.join(cloudStagingDir(), name);
  return fs.existsSync(file) ? file : null;
}

export function clearCloudStaging(): void {
  fs.rmSync(cloudStagingDir(), { recursive: true, force: true });
}

const state = singleton('cloud-backup', () => ({ busy: false }));

/** Builds an encrypted archive in the staging folder for the main process to upload. One at a time. */
export async function prepareCloudUpload(): Promise<{ name: string; path: string; size: number; attachments: number }> {
  if (state.busy) throw new Error('A cloud backup is already being prepared.');
  state.busy = true;
  try {
    clearCloudStaging();
    fs.mkdirSync(cloudStagingDir(), { recursive: true });
    const archive = await createBackupArchive({ targetDir: cloudStagingDir(), requireEncryption: true });
    return { name: archive.name, path: archive.path, size: archive.size, attachments: archive.attachments };
  } finally {
    state.busy = false;
  }
}

export async function recordCloudResult(result: {
  ok: boolean;
  trigger: 'manual' | 'scheduled';
  name?: string;
  size?: number;
  pruned?: number;
  error?: string;
}): Promise<void> {
  clearCloudStaging();
  const config = await readCloudConfig(await getDb());
  const where = config.provider ? CLOUD_PROVIDER_LABEL[config.provider] : 'the cloud';
  await withTransaction(async (tx) => {
    if (result.ok && result.name) {
      await setSetting(tx, KEYS.lastSuccessAt, new Date().toISOString());
      await setSetting(tx, KEYS.lastFile, result.name);
      await setSetting(tx, KEYS.lastSize, String(result.size ?? 0));
      await setSetting(tx, KEYS.lastError, '');
      await setSetting(tx, KEYS.lastErrorAt, '');
      await logAudit(tx, 'created', 'backup', result.name,
        `${result.trigger === 'manual' ? 'Manual' : 'Scheduled'} encrypted backup ${result.name} uploaded to ${where}${config.account ? ` (${config.account})` : ''}${result.pruned ? `; removed ${result.pruned} old backup${result.pruned === 1 ? '' : 's'}` : ''}`);
    } else {
      await setSetting(tx, KEYS.lastError, (result.error || 'The cloud backup failed.').slice(0, 300));
      await setSetting(tx, KEYS.lastErrorAt, new Date().toISOString());
    }
  });
}

export async function recordCloudConnection(provider: CloudProvider | null, account: string | null): Promise<void> {
  const before = await readCloudConfig(await getDb());
  await withTransaction(async (tx) => {
    await setSetting(tx, KEYS.provider, provider ?? '');
    await setSetting(tx, KEYS.account, provider ? (account ?? '').slice(0, 200) : '');
    // A new connection starts with a clean record.
    await setSetting(tx, KEYS.lastError, '');
    await setSetting(tx, KEYS.lastErrorAt, '');
    if (provider) {
      if (before.provider !== provider || before.account !== account) {
        await setSetting(tx, KEYS.lastSuccessAt, '');
        await setSetting(tx, KEYS.lastFile, '');
        await setSetting(tx, KEYS.lastSize, '');
      }
      await logAudit(tx, 'connected', 'backup', provider, `Connected ${CLOUD_PROVIDER_LABEL[provider]}${account ? ` (${account})` : ''} for cloud backups`);
    } else if (before.provider) {
      await logAudit(tx, 'disconnected', 'backup', before.provider, `Disconnected ${CLOUD_PROVIDER_LABEL[before.provider]}${before.account ? ` (${before.account})` : ''} from cloud backups`);
    }
  });
}
