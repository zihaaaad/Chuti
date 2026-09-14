import crypto from 'crypto';
import fs from 'fs';

// Encrypted backup copies.
//
// Key hierarchy (envelope encryption):
//   master key (32 random bytes, one per installation, never leaves the host unwrapped)
//     ├─ wrapped by a key derived from the backup PASSWORD (scrypt)
//     └─ wrapped by a key derived from the printed RECOVERY CODE (HKDF; 200 random bits)
//   file key = HKDF(master key, random per-file salt)  → encrypts one backup
//
// Both wrapped copies ("key slots") are stored in the header of EVERY backup
// file, so any copy can be restored on a new computer with either secret, and
// copies made before a password change still open with the old password or the
// unchanged recovery code.
//
// File layout:  "CHUTIENC" | version (1 byte) | header length (u32 BE) | header JSON | chunks
// Chunks: AES-256-GCM over 1 MiB of plaintext, each followed by its 16-byte tag.
//   nonce = 7-byte random prefix | chunk counter (u32 BE) | last-chunk flag (1 byte)
//   AAD   = SHA-256(header JSON)
// The counter defeats reordering, the flag defeats truncation, the AAD binds
// the header (slots, salts) to the ciphertext.

export const ENCRYPTED_MAGIC = Buffer.from('CHUTIENC', 'ascii');
const FORMAT_VERSION = 1;
const CHUNK_SIZE = 1024 * 1024;
const TAG_SIZE = 16;
const MAX_HEADER_BYTES = 64 * 1024;
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export const MIN_BACKUP_PASSWORD_LENGTH = 12;

export type SlotType = 'password' | 'recovery';

export interface KeySlot {
  type: SlotType;
  kdf: { name: 'scrypt'; N: number; r: number; p: number } | { name: 'hkdf-sha256' };
  salt: string;
  iv: string;
  wrapped: string;
  tag: string;
}

export interface KeyRing {
  keyId: string;
  slots: KeySlot[];
}

export interface EncryptedHeader {
  format: 'chuti-encrypted-backup';
  version: number;
  cipher: 'aes-256-gcm';
  chunkSize: number;
  keyId: string;
  slots: KeySlot[];
  fileSalt: string;
  noncePrefix: string;
  createdAt: string;
}

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCryptoError';
  }
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export function generateMasterKey(): { key: Buffer; keyId: string } {
  return { key: crypto.randomBytes(32), keyId: crypto.randomBytes(8).toString('hex') };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 40 Crockford base32 characters (200 random bits) in groups of five. */
export function generateRecoveryCode(): string {
  const bytes = crypto.randomBytes(25);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{5}/g)!.join('-');
}

/** Decodes a recovery code typed by a person (any case, spaces/dashes, O→0, I/L→1). Null if it isn't one. */
export function parseRecoveryCode(input: string): Buffer | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (cleaned.length !== 40) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx === -1) return null;
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function scryptAsync(secret: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(secret.normalize('NFKC'), salt, 32, { ...params, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function recoveryKek(code: Buffer, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', code, salt, 'chuti-recovery-slot-v1', 32));
}

function slotAad(keyId: string, type: SlotType) {
  return Buffer.from(`chuti-key-slot:${keyId}:${type}`);
}

function wrap(kek: Buffer, masterKey: Buffer, keyId: string, type: SlotType, kdf: KeySlot['kdf'], salt: Buffer): KeySlot {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(slotAad(keyId, type));
  const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  return { type, kdf, salt: salt.toString('base64'), iv: iv.toString('base64'), wrapped: wrapped.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function unwrap(kek: Buffer, slot: KeySlot, keyId: string): Buffer | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(slot.iv, 'base64'));
    decipher.setAAD(slotAad(keyId, slot.type));
    decipher.setAuthTag(Buffer.from(slot.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(slot.wrapped, 'base64')), decipher.final()]);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export async function createPasswordSlot(masterKey: Buffer, keyId: string, password: string): Promise<KeySlot> {
  const salt = crypto.randomBytes(16);
  const kek = await scryptAsync(password, salt, SCRYPT_PARAMS);
  return wrap(kek, masterKey, keyId, 'password', { name: 'scrypt', ...SCRYPT_PARAMS }, salt);
}

export function createRecoverySlot(masterKey: Buffer, keyId: string, recoveryCode: string): KeySlot {
  const code = parseRecoveryCode(recoveryCode);
  if (!code) throw new BackupCryptoError('Invalid recovery code.');
  const salt = crypto.randomBytes(16);
  return wrap(recoveryKek(code, salt), masterKey, keyId, 'recovery', { name: 'hkdf-sha256' }, salt);
}

/**
 * Recovers the master key with a backup password or a recovery code. Returns
 * null when the secret opens neither slot. Resistant to guessing: every
 * password attempt costs a full scrypt derivation.
 */
export async function unlockKeyRing(ring: KeyRing, secret: string): Promise<Buffer | null> {
  const code = parseRecoveryCode(secret);
  if (code) {
    const slot = ring.slots.find((s) => s.type === 'recovery');
    if (slot) {
      const key = unwrap(recoveryKek(code, Buffer.from(slot.salt, 'base64')), slot, ring.keyId);
      if (key) return key;
    }
  }
  const slot = ring.slots.find((s) => s.type === 'password');
  if (!slot || slot.kdf.name !== 'scrypt') return null;
  const { N, r, p } = slot.kdf;
  // Refuse absurd parameters from a crafted header (memory/CPU exhaustion).
  if (N > 2 ** 20 || r > 16 || p > 4) return null;
  const kek = await scryptAsync(secret, Buffer.from(slot.salt, 'base64'), { N, r, p });
  return unwrap(kek, slot, ring.keyId);
}

// ─── Files ───────────────────────────────────────────────────────────────────

function fileKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, 'chuti-backup-file-v1', 32));
}

function chunkNonce(prefix: Buffer, counter: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(counter, 7);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

/** Encrypts `source` into `target`. `target` should be a temporary path the caller renames on success. */
export async function encryptFile(source: string, target: string, masterKey: Buffer, ring: KeyRing, now = new Date()): Promise<void> {
  const fileSalt = crypto.randomBytes(16);
  const noncePrefix = crypto.randomBytes(7);
  const header: EncryptedHeader = {
    format: 'chuti-encrypted-backup',
    version: FORMAT_VERSION,
    cipher: 'aes-256-gcm',
    chunkSize: CHUNK_SIZE,
    keyId: ring.keyId,
    slots: ring.slots,
    fileSalt: fileSalt.toString('base64'),
    noncePrefix: noncePrefix.toString('base64'),
    createdAt: now.toISOString(),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const aad = crypto.createHash('sha256').update(headerBytes).digest();
  const key = fileKey(masterKey, fileSalt);

  const input = await fs.promises.open(source, 'r');
  const output = await fs.promises.open(target, 'w');
  try {
    const prefix = Buffer.alloc(13);
    ENCRYPTED_MAGIC.copy(prefix, 0);
    prefix[8] = FORMAT_VERSION;
    prefix.writeUInt32BE(headerBytes.length, 9);
    await output.write(prefix);
    await output.write(headerBytes);

    const size = (await input.stat()).size;
    const buffer = Buffer.alloc(CHUNK_SIZE);
    let offset = 0;
    let counter = 0;
    for (;;) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new BackupCryptoError('The backup changed while it was being encrypted.');
      offset += length;
      const last = offset >= size;
      const cipher = crypto.createCipheriv('aes-256-gcm', key, chunkNonce(noncePrefix, counter, last));
      cipher.setAAD(aad);
      await output.write(Buffer.concat([cipher.update(buffer.subarray(0, length)), cipher.final(), cipher.getAuthTag()]));
      counter++;
      if (last) break;
    }
    await output.sync();
  } finally {
    await input.close();
    await output.close();
  }
}

export async function isEncryptedBackup(file: string): Promise<boolean> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const magic = Buffer.alloc(8);
    const { bytesRead } = await handle.read(magic, 0, 8, 0);
    return bytesRead === 8 && magic.equals(ENCRYPTED_MAGIC);
  } finally {
    await handle.close();
  }
}

async function readHeaderFrom(handle: fs.promises.FileHandle): Promise<{ header: EncryptedHeader; headerBytes: Buffer; bodyOffset: number }> {
  const prefix = Buffer.alloc(13);
  const { bytesRead } = await handle.read(prefix, 0, 13, 0);
  if (bytesRead !== 13 || !prefix.subarray(0, 8).equals(ENCRYPTED_MAGIC)) throw new BackupCryptoError('This is not an encrypted Chuti backup.');
  if (prefix[8] > FORMAT_VERSION) throw new BackupCryptoError('This backup was made by a newer version of Chuti. Update Chuti, then restore it.');
  const length = prefix.readUInt32BE(9);
  if (length === 0 || length > MAX_HEADER_BYTES) throw new BackupCryptoError('The backup header is damaged.');
  const headerBytes = Buffer.alloc(length);
  const read = await handle.read(headerBytes, 0, length, 13);
  if (read.bytesRead !== length) throw new BackupCryptoError('The backup file is incomplete.');
  let header: EncryptedHeader;
  try {
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    throw new BackupCryptoError('The backup header is damaged.');
  }
  if (header.format !== 'chuti-encrypted-backup' || header.cipher !== 'aes-256-gcm' || header.chunkSize !== CHUNK_SIZE || !Array.isArray(header.slots)) {
    throw new BackupCryptoError('The backup header is damaged.');
  }
  return { header, headerBytes, bodyOffset: 13 + length };
}

export async function readEncryptedHeader(file: string): Promise<EncryptedHeader> {
  const handle = await fs.promises.open(file, 'r');
  try {
    return (await readHeaderFrom(handle)).header;
  } finally {
    await handle.close();
  }
}

/**
 * Decrypts `source` into `target`, authenticating every chunk. On any failure
 * (wrong key, tampering, truncation) `target` is deleted and nothing partial remains.
 */
export async function decryptFile(source: string, target: string, masterKey: Buffer): Promise<void> {
  const input = await fs.promises.open(source, 'r');
  let output: fs.promises.FileHandle | null = null;
  try {
    const { header, headerBytes, bodyOffset } = await readHeaderFrom(input);
    const aad = crypto.createHash('sha256').update(headerBytes).digest();
    const key = fileKey(masterKey, Buffer.from(header.fileSalt, 'base64'));
    const noncePrefix = Buffer.from(header.noncePrefix, 'base64');
    if (noncePrefix.length !== 7) throw new BackupCryptoError('The backup header is damaged.');

    const size = (await input.stat()).size;
    output = await fs.promises.open(target, 'w');
    let position = bodyOffset;
    let counter = 0;
    const full = CHUNK_SIZE + TAG_SIZE;
    for (;;) {
      const remaining = size - position;
      if (remaining < TAG_SIZE) throw new BackupCryptoError('The backup file is incomplete.');
      const last = remaining <= full;
      const length = last ? remaining : full;
      const chunk = Buffer.alloc(length);
      await input.read(chunk, 0, length, position);
      position += length;

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, chunkNonce(noncePrefix, counter, last));
      decipher.setAAD(aad);
      decipher.setAuthTag(chunk.subarray(length - TAG_SIZE));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(chunk.subarray(0, length - TAG_SIZE)), decipher.final()]);
      } catch {
        throw new BackupCryptoError(counter === 0 ? 'This backup could not be decrypted with that key.' : 'The backup file is damaged or was modified.');
      }
      await output.write(plain);
      counter++;
      if (last) break;
    }
  } catch (err) {
    if (output) {
      await output.close();
      output = null;
    }
    fs.rmSync(target, { force: true });
    throw err;
  } finally {
    await input.close();
    if (output) await output.close();
  }
}
