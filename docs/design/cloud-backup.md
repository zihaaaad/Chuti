# Cloud backup — design plan

Status: **Phase 0 shipped; cloud phases proposed** · Updated 2026-09-14 · Scope: desktop (Electron) build

## Decisions (2026-09-14)

| Question | Decision |
|---|---|
| Encryption mandatory? | **Not mandatory, but required as a decision.** Revised after the sync-folder analysis: Chuti saves no copy until the admin sets a backup password or explicitly opts out (with a typed confirmation when the folder syncs to a cloud service). See [backup-security.md](backup-security.md). |
| Include attachments? | **Yes.** Every archive contains the database and all attachments. |
| Priority | **Store on the admin's own computer first.** Phase 0 below is implemented. |
| First cloud provider | Google Drive (most common in the target market), then OneDrive, then Dropbox. |
| App registrations | The project maintainer owns the Google/Microsoft/Dropbox registrations; client IDs come from build-time config so forks use their own. |

## Phase 0 — Backup copies to a local folder (implemented)

- **Settings → Backup copies** writes `Chuti-Backup_YYYY-MM-DD_HHmmss.zip` into a folder chosen on the host computer: a second drive, a USB stick, a NAS share, or a Google Drive / OneDrive **synced folder**. A synced folder already gives off-site cloud storage with no OAuth.
- Each zip holds a `VACUUM INTO` snapshot taken under the write lock, every attachment, and `manifest.json` with SHA-256 checksums, app and schema versions, and record counts (`src/lib/archive.ts`).
- The zip is written to `.partial` and renamed when complete, so an unplugged drive never leaves a file that looks valid.
- Runs daily at a chosen hour (catching up when Chuti next runs if the computer was off), keeps the newest N copies, and retries an hour after a failure (`src/lib/backup-copies.ts`, started from `src/instrumentation.ts`).
- The folder can only be chosen from the desktop window on the host computer: a native folder dialog in `main.js` sends it to `/api/internal/backup-folder` with a per-launch secret. A LAN browser signed in as admin can run, schedule, restore or stop copies, but cannot redirect them elsewhere. `CHUTI_BACKUP_DIR` sets the folder when running from source.
- Restoring a copy rejects unexpected paths (zip-slip), checks every checksum and the SQLite integrity, refuses backups from newer schema versions, saves a pre-restore copy, keeps the backup-folder settings, and puts attachments back.
- Health: the Overview page warns when the last copy failed or none succeeded in 48 hours, and the setup checklist asks for a folder until one is chosen. It also warns when the folder is on the same drive as the data.

## Goal

Let an admin connect a cloud storage account (Google Drive, Microsoft OneDrive, Dropbox) with a one-click "Connect" flow, and have Chuti upload encrypted backups there automatically. A new or rebuilt computer can restore from that account.

## Non-goals

- **Not sync.** Chuti stays single-host. The cloud copy is a backup to restore from, never a live database two machines write to.
- **Not sign-in.** Connecting Google does not replace the admin password. "Continue with Google" here authorizes *storage*, not identity.
- No server run by the Chuti project. Tokens and files go directly between the admin's computer and their provider.

## Verified platform constraints

| Fact | Consequence | Source |
|---|---|---|
| Google desktop apps must use a **loopback redirect** (`http://127.0.0.1:<port>`); custom URI schemes and copy/paste (OOB) are no longer supported. PKCE is supported. The desktop client secret is not confidential. | OAuth runs in the Electron main process with a temporary local listener, in the system browser. | [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app) |
| `drive.file` and `drive.appdata` are **non-sensitive** scopes; full `drive` is restricted and needs a security assessment. | Request only `drive.file` (files Chuti creates, visible to the user). | [Choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) |
| OAuth apps left in **"Testing"** get refresh tokens that **expire after 7 days**. Max 100 refresh tokens per Google account per client ID. | The Google Cloud project must be published to production before release, or backups silently stop after a week. | [Google OAuth 2.0 — refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration) |
| OneDrive `Files.ReadWrite.AppFolder` gives access only to `Apps/<AppName>` via `/drive/special/approot`. | Least-privilege scope; the folder is visible to the user. | [OneDrive App Folder](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/special-folders-appfolder) |
| Dropbox supports PKCE, long-lived refresh tokens (`token_access_type=offline`), and an "App folder" access type. | Same flow as the others; no secret shipped. | [Dropbox OAuth guide](https://developers.dropbox.com/oauth-guide) |
| Electron `safeStorage` on Windows uses DPAPI: protected from other Windows users, **readable by any process running as the same user**. | Good enough for tokens at rest; not a defence against malware on the admin's account. Keep scopes minimal. | [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) |

## Architecture

```
┌──────────── Electron main process ─────────────┐        ┌──────────────┐
│ CloudBackupService                              │ HTTPS  │ Google Drive │
│  ├─ OAuth (loopback + PKCE + state)             │───────▶│ OneDrive     │
│  ├─ TokenStore (safeStorage → cloud.json)       │        │ Dropbox      │
│  ├─ Scheduler (daily + on quit, backoff)        │        └──────────────┘
│  ├─ Packager (snapshot → tar → AES-256-GCM)     │
│  └─ Providers: GoogleDrive | OneDrive | Dropbox │
└───────▲──────────────────────┬──────────────────┘
        │ IPC (preload bridge) │ internal HTTP, per-launch secret
┌───────┴────────┐    ┌────────▼──────────────────────────┐
│ Settings page  │    │ Next server: /api/internal/snapshot│
│ (host window)  │    │  → checkpointedBackup() under lock │
└────────────────┘    └───────────────────────────────────┘
```

Why this shape:

- **OAuth and tokens live in the main process, not the Next server.** The Next server is reachable by every browser on the LAN; the main process is not. Only the Electron window on the host computer gets the `window.chuti.cloud` bridge, so a LAN user can never connect, disconnect, or restore from the cloud. LAN browsers see the status read-only with "Manage from the host computer".
- **Tokens are stored outside `database.db`** (in `%APPDATA%/Chuti/cloud.json`, encrypted with safeStorage). Otherwise every backup would contain the tokens, and restoring an old backup would overwrite the current connection.
- **Snapshots reuse the existing backup code.** The main process calls a localhost-only internal route protected by a random secret passed through the environment at launch. The route runs `checkpointedBackup()` inside the write lock (`src/lib/db.ts`), so the snapshot is consistent.
- **The system browser, not an embedded window,** handles sign-in. Google blocks OAuth in embedded webviews, and the system browser already holds the user's session and password manager.

### Provider interface

```ts
interface CloudProvider {
  id: 'google' | 'onedrive' | 'dropbox';
  connect(): Promise<ConnectedAccount>;          // loopback + PKCE, returns email/display name
  upload(file: ReadableStream, name: string, size: number): Promise<RemoteBackup>; // resumable for large files
  list(): Promise<RemoteBackup[]>;
  download(id: string): Promise<ReadableStream>;
  remove(id: string): Promise<void>;
  disconnect(): Promise<void>;                   // revoke the refresh token, then delete it locally
}
```

Use each provider's REST API with `fetch` rather than full SDKs (`googleapis` alone is large), except `@azure/msal-node` for Microsoft, which handles the public-client loopback flow and token cache correctly. Uploads use each provider's resumable mechanism (Drive resumable upload, Graph upload session, Dropbox upload session).

### Backup package

`chuti-backup-<org-slug>-<YYYYMMDD-HHmm>.chuti` =
AES-256-GCM encrypted tar of:
- `database.db` (checkpointed snapshot),
- `uploads/` attachments (see below),
- `manifest.json`: app version, schema version, created-at, SHA-256 of each file, employee/record counts for display.

**Encryption** reuses the implemented backup-copy protection unchanged ([backup-security.md](backup-security.md)): the same `.chuti` files, key ring, recovery code and DPAPI key store. A cloud provider only uploads files that are already encrypted, so no additional cloud-specific crypto is needed.

**Attachments** are immutable once uploaded. After the first full upload, send only new files (keyed by hash) into an `attachments/` subfolder, and let each manifest reference what it needs. This keeps daily backups small.

### Schedule, retention and failure handling

- Run daily at a chosen time (default 18:00) and when Chuti closes, if the last success is more than 12 hours old. Never run while offline; retry with exponential backoff.
- Retention: keep 7 daily, 4 weekly and 12 monthly backups; prune only after a successful upload.
- After 48 hours without a successful backup, show a warning banner on Overview for the host window.
- Every connect, disconnect, backup, prune and restore writes an entry to the existing `audit_log`.

### Restore

1. **Settings → Cloud backup → Restore**, or "Restore from cloud" on the first-run folder picker of a new computer.
2. Connect the account, pick a backup (shows date, app version, employee count), enter the passphrase or recovery code.
3. Download → verify the GCM tag and SHA-256 manifest → hand the database to the existing `restoreBackup` pipeline, which already runs an integrity check and saves a pre-restore copy → put attachments back.
4. Refuse a backup whose `schema_version` is newer than the running app, and tell the user to update Chuti first.

## UI (Settings → Cloud backup card)

- Not connected: three neutral buttons ("Connect Google Drive", "Connect OneDrive", "Connect Dropbox"), following each provider's brand guidelines for logos.
- Connected: account email, provider, last successful backup, next scheduled run, space used by Chuti backups, **Back up now**, **Restore…**, **Disconnect**.
- The connect flow: set passphrase → print/save recovery code (must tick "I have saved it") → browser opens → "Connected as name@example.com".

## Operational prerequisites (maintainer)

- **Google:** Cloud project, OAuth consent screen (external), Drive API enabled, Desktop client ID, **publishing status set to production**, and brand verification for the app name and logo on the consent screen.
- **Microsoft:** Entra app registration as a public client, redirect `http://localhost`, accounts in any organisation plus personal Microsoft accounts.
- **Dropbox:** App Console app with "App folder" access.
- Client IDs ship inside the binary (public clients, so this is safe). Forks must register their own, so read them from build-time config rather than hard-coding them.

## Delivery plan

| Phase | Scope | Estimate |
|---|---|---|
| **0 — Copy to folder** ✅ | Done — see "Phase 0" above. The cloud phases reuse its archive format, snapshot, restore and health code. | done |
| **1 — Foundation + Google Drive** | Provider interface, TokenStore, loopback/PKCE helper, packager with encryption and recovery code, scheduler, internal snapshot route, Settings card, restore flow, audit entries. Tests: crypto round-trip, manifest verification, provider against a mock HTTP server. | 1.5–2 weeks |
| **2 — OneDrive + Dropbox** | Two more providers behind the same interface. | ~1 week |
| **3 — Polish** | Restore on a new computer from first-run, incremental attachments, retention pruning, quota errors, localisation. | 3–5 days |

