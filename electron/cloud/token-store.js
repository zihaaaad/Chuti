'use strict';

// The cloud connection (provider, account, refresh token) is stored outside the
// data folder, so it is never inside a backup and a restore never changes it.
// It is encrypted with Electron safeStorage (Windows DPAPI): only this Windows
// user on this computer can read it. Without safeStorage nothing is stored.

const fs = require('fs');
const path = require('path');

/**
 * @param {{ file: string, crypto: { available: () => boolean, encrypt: (s: string) => Buffer, decrypt: (b: Buffer) => string } }} o
 */
function createTokenStore({ file, crypto }) {
  return {
    available: () => crypto.available(),

    /** @returns {null | { provider: string, account: string, refreshToken: string, folderId?: string }} */
    read() {
      try {
        if (!fs.existsSync(file) || !crypto.available()) return null;
        const data = JSON.parse(crypto.decrypt(fs.readFileSync(file)));
        return data && typeof data.refreshToken === 'string' && typeof data.provider === 'string' ? data : null;
      } catch (_) {
        return null;
      }
    },

    write(data) {
      if (!crypto.available()) throw new Error('Windows could not protect the sign-in token on this computer, so the account was not connected.');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, crypto.encrypt(JSON.stringify(data)));
      fs.renameSync(tmp, file);
    },

    clear() {
      fs.rmSync(file, { force: true });
    },
  };
}

module.exports = { createTokenStore };
