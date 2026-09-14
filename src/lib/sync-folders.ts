import fs from 'fs';
import path from 'path';

// Detects whether a folder is synced to a cloud storage service, so Chuti can
// warn that files placed there leave the computer. Best effort: it recognises
// the default locations and names used by the common desktop sync clients on
// Windows, not every possible configuration.

export type SyncProvider = 'OneDrive' | 'Google Drive' | 'Dropbox' | 'iCloud Drive' | 'Box' | 'Nextcloud' | 'pCloud' | 'MEGA';

const NAME_PATTERNS: [RegExp, SyncProvider][] = [
  [/^onedrive( - .+)?$/i, 'OneDrive'],
  [/^(google drive|googledrive|my drive|shared drives)$/i, 'Google Drive'],
  [/^dropbox( \(.+\))?$/i, 'Dropbox'],
  [/^(icloud ?drive|icloud)$/i, 'iCloud Drive'],
  [/^box( sync)?$/i, 'Box'],
  [/^nextcloud$/i, 'Nextcloud'],
  [/^pcloud( drive)?$/i, 'pCloud'],
  [/^mega( ?sync)?$/i, 'MEGA'],
];

/** Windows-style paths (C:\…, \\server\share) use win32 rules on every OS, so tests behave the same in CI. */
function pathApi(p: string) {
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(p) ? path.win32 : path;
}

function isInside(child: string, parent: string): boolean {
  const api = pathApi(child);
  const c = api.resolve(child).toLowerCase();
  const p = api.resolve(parent).toLowerCase().replace(/[\\/]+$/, '');
  return c === p || c.startsWith(p + api.sep);
}

type Env = Record<string, string | undefined>;

function dropboxRoots(env: Env): string[] {
  const roots: string[] = [];
  for (const base of [env.LOCALAPPDATA, env.APPDATA]) {
    if (!base) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(base, 'Dropbox', 'info.json'), 'utf8'));
      for (const account of Object.values(info) as { path?: string }[]) {
        if (account?.path) roots.push(account.path);
      }
    } catch {
      // Dropbox not installed for this user.
    }
  }
  return roots;
}

export function detectSyncProvider(folder: string, env: Env = process.env): SyncProvider | null {
  if (!folder) return null;
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[key];
    if (root && isInside(folder, root)) return 'OneDrive';
  }
  for (const root of dropboxRoots(env)) {
    if (isInside(folder, root)) return 'Dropbox';
  }
  const segments = pathApi(folder).resolve(folder).split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    for (const [pattern, provider] of NAME_PATTERNS) {
      if (pattern.test(segment)) return provider;
    }
  }
  return null;
}
