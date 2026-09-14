import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createPasswordSlot,
  createRecoverySlot,
  decryptFile,
  encryptFile,
  generateMasterKey,
  generateRecoveryCode,
  isEncryptedBackup,
  parseRecoveryCode,
  readEncryptedHeader,
  unlockKeyRing,
  type KeyRing,
} from './backup-crypto';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-crypto-'));
  temps.push(d);
  return d;
}

const PASSWORD = 'correct horse battery staple';
let master: { key: Buffer; keyId: string };
let recoveryCode: string;
let ring: KeyRing;

beforeAll(async () => {
  master = generateMasterKey();
  recoveryCode = generateRecoveryCode();
  ring = { keyId: master.keyId, slots: [await createPasswordSlot(master.key, master.keyId, PASSWORD), createRecoverySlot(master.key, master.keyId, recoveryCode)] };
}, 30_000);

function sample(dir: string, bytes: number) {
  const f = path.join(dir, 'plain.zip');
  fs.writeFileSync(f, crypto.randomBytes(bytes));
  return f;
}

describe('recovery codes', () => {
  it('generates 40-character codes in groups of five and parses sloppy typing', () => {
    expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/);
    const typed = recoveryCode.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(parseRecoveryCode(typed)).toEqual(parseRecoveryCode(recoveryCode));
    expect(parseRecoveryCode(recoveryCode)).toHaveLength(25);
    expect(parseRecoveryCode('too short')).toBeNull();
    expect(parseRecoveryCode(PASSWORD)).toBeNull();
  });
});

describe('key ring', () => {
  it('unlocks with the password or the recovery code, and not with anything else', async () => {
    expect((await unlockKeyRing(ring, PASSWORD))?.equals(master.key)).toBe(true);
    expect((await unlockKeyRing(ring, recoveryCode))?.equals(master.key)).toBe(true);
    expect(await unlockKeyRing(ring, 'correct horse battery stapl3')).toBeNull();
    expect(await unlockKeyRing(ring, generateRecoveryCode())).toBeNull();
  }, 30_000);

  it('refuses a crafted header with huge scrypt parameters', async () => {
    const evil: KeyRing = { keyId: ring.keyId, slots: ring.slots.map((s) => (s.type === 'password' ? { ...s, kdf: { name: 'scrypt' as const, N: 2 ** 30, r: 8, p: 1 } } : s)) };
    expect(await unlockKeyRing(evil, PASSWORD)).toBeNull();
  });
});

describe('encryptFile / decryptFile', () => {
  it.each([
    ['empty', 0],
    ['small', 1000],
    ['exactly one chunk', 1024 * 1024],
    ['several chunks', 2.5 * 1024 * 1024],
  ])('round-trips a %s file', async (_label, bytes) => {
    const dir = tmp();
    const plain = sample(dir, bytes);
    const enc = path.join(dir, 'backup.chuti');
    const out = path.join(dir, 'restored.zip');
    await encryptFile(plain, enc, master.key, ring);
    expect(await isEncryptedBackup(enc)).toBe(true);
    await decryptFile(enc, out, master.key);
    expect(fs.readFileSync(out).equals(fs.readFileSync(plain))).toBe(true);
  });

  it('never stores plaintext or the master key in the file', async () => {
    const dir = tmp();
    const plain = path.join(dir, 'plain.zip');
    const marker = 'SICK-NOTE-Rahim-Uddin-EMP-001';
    fs.writeFileSync(plain, marker.repeat(1000));
    const enc = path.join(dir, 'backup.chuti');
    await encryptFile(plain, enc, master.key, ring);
    const raw = fs.readFileSync(enc);
    expect(raw.includes(Buffer.from(marker))).toBe(false);
    expect(raw.includes(master.key)).toBe(false);
    const header = await readEncryptedHeader(enc);
    expect(header.keyId).toBe(master.keyId);
    expect(header.slots.map((s) => s.type).sort()).toEqual(['password', 'recovery']);
  });

  it('rejects the wrong key without leaving a partial output', async () => {
    const dir = tmp();
    const enc = path.join(dir, 'backup.chuti');
    await encryptFile(sample(dir, 5000), enc, master.key, ring);
    const out = path.join(dir, 'restored.zip');
    await expect(decryptFile(enc, out, generateMasterKey().key)).rejects.toThrow(/could not be decrypted/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('detects a flipped bit, truncation at a chunk boundary, and a modified header', async () => {
    const dir = tmp();
    const enc = path.join(dir, 'backup.chuti');
    await encryptFile(sample(dir, 2.5 * 1024 * 1024), enc, master.key, ring);
    const original = fs.readFileSync(enc);
    const headerLength = original.readUInt32BE(9);
    const body = 13 + headerLength;

    const flipped = Buffer.from(original);
    flipped[body + 1024 * 1024 + 100] ^= 1; // inside chunk 2
    fs.writeFileSync(enc, flipped);
    await expect(decryptFile(enc, path.join(dir, 'a'), master.key)).rejects.toThrow(/damaged or was modified/);

    // Drop the final chunk: chunk 2 now looks last, but was sealed as not-last.
    fs.writeFileSync(enc, original.subarray(0, body + 2 * (1024 * 1024 + 16)));
    await expect(decryptFile(enc, path.join(dir, 'b'), master.key)).rejects.toThrow();

    // Same-length header edit (createdAt year) breaks the AAD binding.
    const edited = Buffer.from(original);
    const at = edited.indexOf(Buffer.from('"createdAt":"2'));
    edited[at + 14] = edited[at + 14] === 0x31 ? 0x32 : 0x31;
    fs.writeFileSync(enc, edited);
    await expect(decryptFile(enc, path.join(dir, 'c'), master.key)).rejects.toThrow(/could not be decrypted/);
  });

  it('uses a fresh file key per backup', async () => {
    const dir = tmp();
    const plain = sample(dir, 4096);
    const a = path.join(dir, 'a.chuti');
    const b = path.join(dir, 'b.chuti');
    await encryptFile(plain, a, master.key, ring);
    await encryptFile(plain, b, master.key, ring);
    const tailA = fs.readFileSync(a).subarray(-4112);
    const tailB = fs.readFileSync(b).subarray(-4112);
    expect(tailA.equals(tailB)).toBe(false);
  });
});
