import 'server-only';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { singleton } from './singleton';

// Leave attachments (sick notes, application scans). Stored in the data folder
// and served only to signed-in admins by /api/uploads/[filename].

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * `<data folder>/uploads`. When running from source the data folder is the
 * project folder. Attachments must never live under `public/`, which Next.js
 * serves as static files without any sign-in check; older source installs
 * kept them in `public/uploads`, so those files are moved out once.
 */
export function uploadsDir(): string {
  const dir = path.join(process.env.APP_DATA_DIR || process.cwd(), 'uploads');
  if (!process.env.APP_DATA_DIR) {
    const state = singleton('legacy-uploads', () => ({ checked: false }));
    if (!state.checked) {
      state.checked = true;
      moveLegacyUploads(path.join(process.cwd(), 'public', 'uploads'), dir);
    }
  }
  return dir;
}

function moveLegacyUploads(legacy: string, target: string) {
  try {
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const from = path.join(legacy, name);
      const to = path.join(target, name);
      if (!fs.statSync(from).isFile()) continue;
      if (fs.existsSync(to)) fs.rmSync(from);
      else fs.renameSync(from, to);
    }
    if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy);
    console.log(`[attachments] Moved attachments out of public/uploads into ${target}`);
  } catch (err) {
    console.error('[attachments] Could not move attachments out of public/uploads:', err);
  }
}

export function attachmentError(file: File | null): string | null {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_ATTACHMENT_BYTES) return 'The attachment is larger than 10 MB. Scan at a lower resolution or save as PDF.';
  if (!ATTACHMENT_TYPES[path.extname(file.name).toLowerCase()]) {
    return 'Attachments must be JPG, PNG, GIF, WEBP, PDF, DOC or DOCX.';
  }
  return null;
}

/** Writes the file and returns its public path (/uploads/…). Call before opening a transaction. */
export async function saveAttachment(file: File): Promise<string> {
  const dir = uploadsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(file.name).toLowerCase();
  const stem = path.basename(file.name, path.extname(file.name)).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 60) || 'attachment';
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${stem}${ext}`;
  await fs.promises.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${filename}`;
}

export async function deleteAttachment(publicPath: string | null | undefined): Promise<void> {
  if (!publicPath) return;
  const full = path.join(uploadsDir(), path.basename(publicPath));
  try {
    await fs.promises.unlink(full);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Failed to delete attachment ${full}:`, err);
  }
}

export function isPreviewable(publicPath: string): boolean {
  const type = ATTACHMENT_TYPES[path.extname(publicPath).toLowerCase()] ?? '';
  return type.startsWith('image/') || type === 'application/pdf';
}
