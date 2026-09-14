# Chuti — Leave Management System

**Chuti** is a lightweight, offline-first, local Leave Management System designed specifically for the operational needs of companies, schools, colleges, and training institutes. It provides a simple, unified interface for administrators to manage employee directories, record leave history, adjust balances, and compile payroll summary reports—without requiring cloud hosting, external database servers, or an active internet connection.

---

## Key Features

- **Local & Secure Data Integrity:** All data remains completely on-premises. Information is stored in a robust, WAL-configured SQLite database on the host machine, ensuring resilience against power outages.
- **Multi-Mode Execution:**
  - **Desktop Application:** Run as a standalone Windows application (`Chuti-Setup.exe` or `Chuti-Portable.exe`) with a clean, native user interface.
  - **LAN Network Sharing:** Host the application on a primary computer, allowing all colleagues on the same office Local Area Network (LAN) to securely access the portal via their web browsers.
- **Single-Admin Architecture:** Eliminates complex employee login flows. A single centralized administrator manages directories, records leaves, and configures settings from one intuitive interface.
- **Automated Business Logic:**
  - **Preconfigured Quotas:** Built-in tracking for Casual Leave (CL), Sick Leave (SL), Earned Leave (EL), and Maternity Leave (ML).
  - **Live Day Preview:** The leave form shows the days charged, how weekends and holidays were treated, and the balance before and after — before you save.
  - **Sandwich Rule:** When enabled, weekends and holidays that fall *between* two leave days are charged.
  - **Attendance Deductions:** Deducts Casual Leave based on a configurable monthly late-arrival threshold, never below zero.
  - **Leave Encashment:** Log and deduct encashed Earned Leave days.
  - **Leave Year Closing:** Carry unused Earned Leave forward (with a cap), lapse the rest, and lock the closed year.
- **Employee Ledger:** A page per employee with balances and every leave, encashment and late cut, printable as a statement.
- **Activity Log:** Every change is recorded with the time and the device that made it.
- **Document Management:** Upload scans, medical certificates, or applications directly to local storage for quick preview inside the application.
- **Backup Copies:** Daily full copies (database + attachments, verified with checksums) saved to a folder you choose — a USB drive, a second disk, or a Google Drive / OneDrive synced folder — with retention, failure warnings and one-click restore.
- **Encrypted Backups:** Copies are encrypted with AES-256 using a backup password, with a printed recovery code for emergencies. Chuti detects cloud-synced folders and won't save copies until you choose how they are protected. See [docs/design/backup-security.md](docs/design/backup-security.md).
- **Integrity:** Quick restore points on start-up and every 12 hours, verified restores, and a balance check that recalculates balances from the leave records.
- **Print-Ready Reporting:** A4 landscape Leave Ledgers and Monthly Payroll Summaries (leave that spans two months is split correctly), plus Excel-compatible CSV export.
- **Automatic Updates:** The installed desktop app updates itself from GitHub releases.

---

## Installation & Deployment

### Method A: Standalone Desktop App (Recommended)
No technical knowledge or pre-installed software is required.

1. Navigate to the **Releases** section on GitHub.
2. Download **`Chuti-Setup.exe`** (Installer) or **`Chuti-Portable.exe`** (Standalone).
3. Execute the file. 
4. Upon first launch, select a designated directory (e.g., `Documents/ChutiData`) where the system will safely store the database, attachments, and automated backups.

### Method B: Self-Hosted Server (For Developers)
If you prefer to run the system directly from the source code:

**Windows Environment:**
1. Ensure **Node.js v20+** is installed.
2. Execute **`start.bat`**.
3. The script will automatically resolve dependencies and launch the portal locally.

**macOS / Linux Environment:**
```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Build the Next.js application
npm run build

# 3. Start the LAN network server
npm run start-lan
```

---

## Network & Administration

### First Sign-in
A new installation starts with the password `admin123`. Chuti will not open the console until you replace it with your own password (at least 8 characters). Changing the password signs out every other browser.

### Office LAN Sharing
For safety, a new installation can only be used on the computer it runs on. To share it across your office network:
1. On the host computer, choose **Network → Allow Access from Other Computers**. Chuti restarts.
2. Use **Network → Copy LAN URL to Clipboard** (e.g., `http://192.168.1.100:3000`) and share it with authorised staff.
3. Make sure the host's firewall allows inbound TCP traffic on that port.

Only enable this on a trusted network, with a strong admin password. Installations that already existed before this setting was introduced keep network access on after updating. When running from source, `npm start` / `npm run dev` are local-only; use `npm run start-lan` / `npm run dev-lan`, or answer **Y** to the network question in `start.bat`.

---

## Data Migration & Recovery

### Backup Copies
In the desktop app, open **Settings → Backup copies → Choose backup folder…** and pick a USB drive, a second disk, or a Google Drive / OneDrive synced folder. Then choose **Set a backup password** and store the recovery code offline. Chuti saves an encrypted full copy daily and keeps the newest 30.

When running from source, use environment variables instead:

| Variable | Effect |
|---|---|
| `CHUTI_BACKUP_DIR` | Folder for backup copies |
| `CHUTI_BACKUP_PASSWORD` | Enables or unlocks encrypted copies at start-up (the recovery code is printed to the console once) |
| `CHUTI_BACKUP_ENCRYPTION=off` | Explicitly save copies without encryption |

### Restoring Backups
1. Open **Settings → Backup copies** (full copies with attachments) or **Quick restore points** (database only).
2. Choose **Restore** and type `RESTORE` to confirm.
3. Chuti checks the file for damage, saves a copy of the current data, then restores. To undo, restore the "Before a restore" point.

### Hardware Migration
Migrating to new hardware is entirely frictionless:
1. Locate your selected **Data Folder** (which contains `database.db`, the `uploads/` directory, and `backups/`).
2. Transfer this entire folder to the new hardware via USB or network transfer.
3. Launch Chuti on the new machine and point it to the copied directory. All records and configurations will resume instantly.

---

## Development

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000
npm test             # unit + database tests (Vitest)
npm run typecheck && npm run lint
```

Code layout:

| Path | Purpose |
|------|---------|
| `src/lib/domain/` | Pure leave rules — day counting, sandwich rule, overlaps, balances, CSV. No I/O; fully unit-tested. |
| `src/lib/db.ts` | SQLite connection, serialized `withTransaction`, backups. |
| `src/lib/migrations.ts` | Versioned schema migrations. Append new ones; never edit shipped ones. |
| `src/lib/auth.ts` | Session verification (`verifySession`, `requireAdmin`). Every page and action checks it. |
| `src/lib/action.ts`, `validation.ts` | Server Action wrapper and zod input schemas. |
| `src/app/actions/` | Server Actions, one file per feature. |
| `src/components/` | Shared UI: dialogs, employee picker, form fields, badges. |

---

## License & Open Source

This project is licensed under the **MIT License**. See the `LICENSE` file for details. You are encouraged to utilize, modify, and distribute this software within your organization.
