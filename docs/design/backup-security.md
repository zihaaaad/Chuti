# Backup copy security — design

Status: **implemented** · 2026-09-14 · Code: `src/lib/backup-crypto.ts`, `backup-keys.ts`, `backup-copies.ts`, `sync-folders.ts`, `src/app/api/internal/*`, `main.js`

## Problem

Backup copies are complete: staff personal data, leave reasons (often medical), attachments (sick notes, scans), settings and the audit log. Admins are encouraged to save them to a USB drive or a Google Drive / OneDrive / Dropbox **synced folder**. A plain zip there can be read by anyone who:

- signs in to that cloud account (a stolen password, or no 2-step verification),
- receives a share or "anyone with the link" URL to the folder,
- uses another device signed in to the same account,
- picks up the USB drive.

Deleted copies also stay in the provider's recycle bin and version history for a while.

## Goals and non-goals

| Goal | How |
|---|---|
| A copy on its own reveals nothing | AES-256-GCM encryption before the file reaches the backup folder |
| Restore works on a new computer with nothing but the file and a secret | Wrapped keys travel inside every copy |
| Losing the password is recoverable | A printed 200-bit recovery code opens every copy |
| Scheduled copies need no typing | The key is kept on the host, protected by Windows DPAPI |
| No silent unprotected copies | Nothing is written until the admin sets a password or explicitly opts out |
| Tampering and truncation are detected | Authenticated chunks and a bound header |

**Non-goals:** protecting against malware or a person with full control of the host Windows account. They can read the live database, which is necessarily unencrypted for the app to work. This design protects copies that **leave** the computer.

## Threat model summary

| Attacker has | Unencrypted copies | Encrypted copies |
|---|---|---|
| The cloud account, a share link, or the USB drive | Everything | Nothing (only file sizes and dates) |
| The above **plus** the backup password or recovery code | Everything | Everything, as with any encryption |
| A LAN browser signed in as admin | Full app access already | Cannot change protection, choose the folder, or read keys |
| Physical access to the host, not signed in to Chuti | — | Cannot change protection (the internal routes need an admin session; DevTools is disabled in packaged builds) |
| The host Windows account (malware) | Everything | Everything: out of scope |

## Findings fixed alongside

1. **Live sign-in sessions were inside every backup.** Session tokens were stored in plain text and copied into backups, so a copy plus network access meant admin access for 7 days without the password. Now tokens are stored as SHA-256 hashes (migration 3 clears old rows), sessions are stripped from copy snapshots, and restores keep the current sign-ins instead of reviving backed-up ones.
2. **Duplicated module state.** Next.js can load a module in several bundles, so the write lock, connection, scheduler and unlocked key could have existed more than once per process. That state now lives in process-wide singletons (`src/lib/singleton.ts`).
4. **Attachments readable without sign-in (source mode).** Found in the final audit. When run from source, attachments were stored in `public/uploads`. Next.js serves `public/` as static files before `afterFiles` rewrites, so `/uploads/<file>` returned the file without authentication. Verified: HTTP 200 with the file body on the old config, 401 after the fix. The rewrite is now `beforeFiles`, so it always goes through the authenticated route, and attachments are stored in `<project>/uploads`, with existing files moved out of `public/` once.
3. **Data folder inside a synced folder.** `Documents` is often redirected to OneDrive. A live SQLite database there is uploaded unencrypted, and sync clients can corrupt its WAL files. The first-run folder picker and Settings now detect this and warn.

## Key hierarchy

```
master key MK (32 random bytes, one per installation, rotated by turning protection off and on)
  ├─ password slot:  AES-256-GCM( scrypt(password, salt, N=2^17, r=8, p=1),  MK )
  └─ recovery slot:  AES-256-GCM( HKDF-SHA256(recovery code, salt),          MK )
file key = HKDF-SHA256(MK, random 16-byte file salt, "chuti-backup-file-v1")   (unique per copy)
```

- **Recovery code:** 40 Crockford base32 characters (200 bits) in groups of five. Parsing tolerates case, spaces, dashes, O→0 and I/L→1. With 200 bits of entropy, HKDF is enough; no slow KDF is needed.
- **Slots are bound to their key:** each slot's GCM AAD is `chuti-key-slot:<keyId>:<type>`, so a slot can't be swapped between key rings or between types.
- **Changing the password** re-wraps the same MK with a new password slot and keeps the recovery slot. New copies use the new password; older copies still open with the old password or the recovery code.
- **Crafted headers:** scrypt parameters read from a file are capped (N ≤ 2^20, r ≤ 16, p ≤ 4), so a malicious file can't exhaust memory or CPU.

## Where secrets live

| Item | Stored in | Why |
|---|---|---|
| Password | Nowhere | Only derived at set/change/unlock time |
| Recovery code | Nowhere | Shown once; the admin must confirm they stored it |
| Key ring (wrapped slots) | Database settings, and every copy's header | Safe to copy: useless without a secret |
| Master key | Server memory, plus `%APPDATA%\Chuti\backup-key.dat` encrypted with DPAPI (`safeStorage`) | Outside the data folder, which may itself be copied or synced; readable only by this Windows user |
| Protection mode | Database settings | Preserved across restores, so restoring an old copy can't switch protection off |

**Startup:** the Electron main process decrypts `backup-key.dat` and sends it to the local server through `/api/internal/backup-encryption` (`load`). The server accepts it only if it matches the current key ring. The raw key is never sent to the web page; the preload bridge returns only success and, once, the recovery code.

## Control plane

- `/api/internal/backup-folder` and `/api/internal/backup-encryption` require the per-launch secret that `main.js` generates and passes to the server, **and** a signed-in admin session forwarded from the app window's cookies (except `load`, which runs before anyone signs in and only accepts the current key).
- In the preload bridge, IPC handlers check that the caller frame is the app's own `http://localhost:<port>` page.
- Every change is written to the audit log: enable, change, unlock failures, disable, folder, backups and restores. Secrets are never logged.
- **Source mode:** `CHUTI_BACKUP_PASSWORD` enables or unlocks protection at startup (the recovery code is printed once to the console); `CHUTI_BACKUP_ENCRYPTION=off` records an explicit opt-out.

## File format (`Chuti-Backup_YYYY-MM-DD_HHmmss.chuti`)

```
"CHUTIENC" (8) | version (1) | header length u32 BE (4) | header JSON | chunk*
header: { format, version, cipher:"aes-256-gcm", chunkSize:1048576, keyId, slots[], fileSalt, noncePrefix(7B), createdAt }
chunk:  AES-256-GCM(file key, nonce = noncePrefix | counter u32 BE | lastFlag u8, AAD = SHA-256(header)) → ciphertext | 16-byte tag
```

- **Reordering** is detected by the counter in the nonce; **truncation at a chunk boundary** by the last-chunk flag; **header edits** by the AAD. Wrong-key and tamper errors are distinct, and decryption deletes partial output.
- **Plaintext never enters the backup folder:** the zip is built in a work folder inside the local data folder, encrypted to `<name>.chuti.partial` in the backup folder, and renamed when complete. The work folder is always removed.
- **Unencrypted copies** (explicit opt-out) keep the `.zip` format from Phase 0.

## Residual risks and operating advice

- **The password is the whole security.** At least 12 characters, not the admin password, not repetitive. Passphrases are suggested.
- **Recovery code storage:** on paper or offline, never in the backup folder or the same cloud account.
- **Restoring an encrypted copy from a LAN browser** sends the secret over plain HTTP on the office network, the same exposure as the admin password at login. The UI says to type it only on the host or a trusted network.
- **Visible metadata:** file names reveal the backup date; file sizes reveal roughly how much data there is.
- **Cloud account hygiene is still required:** 2-step verification on, no sharing, empty the recycle bin after a suspected leak.

## Verification

- **Unit tests:** crypto round-trips (empty, small, exactly one chunk, multi-chunk), wrong key, flipped bit, truncation, header edit, per-file key uniqueness, no plaintext or key in the output, recovery code parsing, crafted scrypt parameters, password policy, locked-after-restart and re-arming, sessions absent from copies, sync-folder detection.
- **End-to-end** against a production build: internal routes reject a missing session (401) and a wrong secret (404); weak and reused passwords are refused; an encrypted copy lands in a OneDrive-named folder with no plaintext markers; after a restart copies are locked and Back up now is disabled; restore prompts for a secret, refuses a wrong one, and succeeds with a carelessly typed recovery code; changing the password keeps the master key; stored-key `load` accepts only the current key ring.
