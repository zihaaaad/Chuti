import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Source-mode installs used to keep attachments in public/uploads, which Next.js
// serves as static files without a sign-in check. uploadsDir() moves them out.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-uploads-'));
const originalCwd = process.cwd();

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('uploadsDir', () => {
  it('moves legacy attachments out of public/uploads and never returns a public path', async () => {
    delete process.env.APP_DATA_DIR;
    fs.mkdirSync(path.join(root, 'public', 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'uploads', '1_note.pdf'), 'sick note');
    process.chdir(root);

    const { uploadsDir } = await import('./attachments');
    const dir = uploadsDir();

    expect(fs.realpathSync(dir)).toBe(fs.realpathSync(path.join(root, 'uploads')));
    expect(dir.split(path.sep)).not.toContain('public');
    expect(fs.readFileSync(path.join(dir, '1_note.pdf'), 'utf8')).toBe('sick note');
    expect(fs.existsSync(path.join(root, 'public', 'uploads'))).toBe(false);
  });
});
