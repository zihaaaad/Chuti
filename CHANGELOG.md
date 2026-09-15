# Changelog

All notable changes to Chuti are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-09-15

### Added
- **Team calendar**: a month grid of who is on leave each day, with weekends, holidays, uncharged days off inside a leave, half days and daily absence totals. Filter by department and print.
- **Excel export**: the monthly payroll summary and leave ledger as a real `.xlsx` workbook, built from the same data as the Reports page.
- **Custom leave types** (Settings → Leave types): add types such as Study Leave with a yearly quota, a paid or unpaid rule and a colour. Used types can be switched off but not deleted. Paid days in payroll subtract every unpaid type.
- **Late arrivals by date**: each late arrival is recorded on its date and can be removed; the monthly Casual Leave cut is recalculated automatically and never exceeds the balance.
- **Holiday import** from a CSV file (`Title, StartDate, EndDate`, ISO or day-first dates) with a preview; a template is included.
- **Cloud backup** to Google Drive or OneDrive: browser sign-in, encrypted daily uploads with retention, restore from the cloud, and health warnings. Chuti only sees its own folder, and sign-in tokens are protected by Windows outside the database.
- **Backup copies**: daily full copies (database and attachments, checksummed) to a folder you choose, with retention, warnings and verified restore.
- **Backup encryption**: AES-256-GCM with a backup password and a printed recovery code; Chuti detects cloud-synced folders and won't save copies until protection is chosen.
- Employee ledger pages with printable statements, an activity log, leave-year closing with Earned Leave carry-forward, a balance check, live leave-day preview, dark mode, and automatic updates for the installed app.

### Changed
- Chuti is reachable only from the computer it runs on until **Network → Allow Access from Other Computers** is turned on. Installs that already shared over the network keep doing so.
- A new installation must replace the default admin password on first sign-in.
- Server code split into per-feature modules with validation; leave rules moved into unit-tested domain modules.
- Electron upgraded to 44 and Next.js to 16.3.5.

### Fixed
- Attachments could be downloaded without signing in when running from source.
- Concurrent saves on the shared database connection could undo each other.
- Leave spanning two months was double counted in payroll; a quota of 0 was reset to the default; "today" used UTC instead of local time.
- A database migration could delete leave records; migrations are now versioned.
- Session tokens are stored hashed and are never copied into backups.

### Security
- The admin password hash is no longer sent to the browser.
- Internal desktop-only routes require a per-launch secret and a signed-in admin.
- `npm audit` reports no known vulnerabilities.

## [1.0.3] — 2026-07-29

- Login screen redesign, app icon, landing page theme, and fixes for attachments, backups and leave encashment.

[1.1.0]: https://github.com/zihaaaad/Chuti/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/zihaaaad/Chuti/releases/tag/v1.0.3
