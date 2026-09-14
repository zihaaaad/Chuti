import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';

// Full backup archives: one .zip per backup holding a consistent database
// snapshot, every leave attachment, and a manifest with SHA-256 checksums.
// Written for a folder the admin chooses (second drive, USB stick, NAS, or a
// Google Drive / OneDrive synced folder). Pure file I/O: no database access,
// so it can be unit-tested with temp folders.

export const ARCHIVE_FORMAT = 'chuti-backup';
export const ARCHIVE_FORMAT_VERSION = 1;
// .zip = unencrypted archive; .chuti = the same archive encrypted (see backup-crypto.ts).
const ARCHIVE_NAME_RE = /^Chuti-Backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.(zip|chuti)$/;
const MAX_TOTAL_BYTES = 8 * 1024 ** 3;

export interface ArchiveFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  organisation: string;
  counts: { employees: number; leaveRecords: number; attachments: number };
  files: ArchiveFileEntry[];
}

export interface ArchiveInfo {
  name: string;
  size: number;
  createdAt: string;
  encrypted: boolean;
}

export function archiveFileName(date: Date = new Date(), extension: 'zip' | 'chuti' = 'zip'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Chuti-Backup_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.${extension}`;
}

export function isArchiveName(name: string): boolean {
  return ARCHIVE_NAME_RE.test(name);
}

/** Archives in `dir`, newest first. Only files matching Chuti's own naming are listed. */
export function listArchives(dir: string): ArchiveInfo[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(isArchiveName)
    .map((name) => {
      const [, y, mo, d, h, mi, s, ext] = ARCHIVE_NAME_RE.exec(name)!;
      const size = fs.statSync(path.join(dir, name)).size;
      return { name, size, createdAt: new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString(), encrypted: ext === 'chuti' };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Deletes the oldest archives beyond `keep`. Never touches files that don't match Chuti's naming. */
export function pruneArchives(dir: string, keep: number): string[] {
  const removed: string[] = [];
  for (const old of listArchives(dir).slice(Math.max(1, keep))) {
    fs.rmSync(path.join(dir, old.name), { force: true });
    removed.push(old.name);
  }
  return removed;
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

const STORED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.docx']);

/**
 * Writes `<targetDir>/Chuti-Backup_<timestamp>.zip`. The zip is written to a
 * `.partial` file first and renamed when complete, so an interrupted backup
 * (unplugged USB drive, full disk) never looks like a valid archive.
 */
export async function writeArchive(options: {
  databaseSnapshot: string;
  uploadsDir: string;
  targetDir: string;
  meta: Omit<ArchiveManifest, 'format' | 'formatVersion' | 'createdAt' | 'files' | 'counts'> & {
    counts: Omit<ArchiveManifest['counts'], 'attachments'>;
  };
  now?: Date;
  /** File name to write; defaults to the timestamped .zip name. */
  name?: string;
}): Promise<{ name: string; size: number; manifest: ArchiveManifest }> {
  const { databaseSnapshot, uploadsDir, targetDir, meta } = options;
  const now = options.now ?? new Date();

  const attachments = fs.existsSync(uploadsDir)
    ? fs
        .readdirSync(uploadsDir, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort()
    : [];

  const files: ArchiveFileEntry[] = [
    { path: 'database.db', size: fs.statSync(databaseSnapshot).size, sha256: await sha256File(databaseSnapshot) },
  ];
  for (const name of attachments) {
    const full = path.join(uploadsDir, name);
    try {
      files.push({ path: `uploads/${name}`, size: fs.statSync(full).size, sha256: await sha256File(full) });
    } catch (err) {
      // Deleted between listing and hashing (leave record removed mid-backup): skip it.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: now.toISOString(),
    ...meta,
    counts: { ...meta.counts, attachments: files.length - 1 },
    files,
  };

  fs.mkdirSync(targetDir, { recursive: true });
  const name = options.name ?? archiveFileName(now);
  const finalPath = path.join(targetDir, name);
  const partialPath = `${finalPath}.partial`;

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
  for (const f of files) {
    const source = f.path === 'database.db' ? databaseSnapshot : path.join(uploadsDir, f.path.slice('uploads/'.length));
    zip.addFile(source, f.path, { compress: !STORED_EXTENSIONS.has(path.extname(f.path).toLowerCase()) });
  }
  zip.end();

  try {
    await pipeline(zip.outputStream, fs.createWriteStream(partialPath));
    fs.renameSync(partialPath, finalPath);
  } catch (err) {
    fs.rmSync(partialPath, { force: true });
    throw err;
  }
  return { name, size: fs.statSync(finalPath).size, manifest };
}

function allowedEntry(fileName: string): boolean {
  if (fileName === 'manifest.json' || fileName === 'database.db') return true;
  const m = /^uploads\/([^/\\]+)$/.exec(fileName);
  return !!m && !m[1].startsWith('.') && m[1] !== '..';
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/**
 * Extracts an archive into `destDir` and verifies it against its manifest.
 * Rejects unexpected paths (zip-slip), oversized content, missing files and
 * checksum mismatches. Returns the manifest.
 */
export async function extractArchive(zipPath: string, destDir: string): Promise<ArchiveManifest> {
  fs.mkdirSync(path.join(destDir, 'uploads'), { recursive: true });
  const hashes = new Map<string, { sha256: string; size: number }>();
  let total = 0;

  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  } catch {
    throw new ArchiveError('This file is not a readable Chuti backup archive.');
  }

  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      zip.close();
      reject(err instanceof ArchiveError ? err : new ArchiveError(`The backup archive is damaged: ${(err as Error).message}`));
    };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/')) return zip.readEntry();
      if (!allowedEntry(entry.fileName)) return fail(new ArchiveError(`The archive contains an unexpected file: ${entry.fileName}`));
      total += entry.uncompressedSize;
      if (total > MAX_TOTAL_BYTES) return fail(new ArchiveError('The archive is larger than Chuti can restore.'));

      const out = path.join(destDir, ...entry.fileName.split('/'));
      const hash = crypto.createHash('sha256');
      zip
        .openReadStreamPromise(entry)
        .then((stream) => {
          stream.on('data', (chunk: Buffer) => hash.update(chunk));
          return pipeline(stream, fs.createWriteStream(out));
        })
        .then(() => {
          hashes.set(entry.fileName, { sha256: hash.digest('hex'), size: entry.uncompressedSize });
          zip.readEntry();
        }, fail);
    });
    zip.readEntry();
  });

  const manifestPath = path.join(destDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new ArchiveError('The archive has no manifest, so it was not made by Chuti.');
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new ArchiveError('The archive manifest is unreadable.');
  }
  if (manifest.format !== ARCHIVE_FORMAT || !Array.isArray(manifest.files)) {
    throw new ArchiveError('This archive was not made by Chuti.');
  }
  if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError('This backup was made by a newer version of Chuti. Update Chuti, then restore it.');
  }
  if (!manifest.files.some((f) => f.path === 'database.db')) throw new ArchiveError('The archive does not contain a database.');

  for (const f of manifest.files) {
    const got = hashes.get(f.path);
    if (!got) throw new ArchiveError(`The archive is incomplete: ${f.path} is missing.`);
    if (got.sha256 !== f.sha256) throw new ArchiveError(`The archive is damaged: ${f.path} does not match its checksum.`);
  }
  return manifest;
}
