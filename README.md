# Chuti — Leave Management System

[![Build & Release Status](https://github.com/zihaaaad/Chuti/actions/workflows/build-release.yml/badge.svg)](https://github.com/zihaaaad/Chuti/actions/workflows/build-release.yml)
[![Latest Release](https://img.shields.io/github/v/release/zihaaaad/Chuti?color=blue)](https://github.com/zihaaaad/Chuti/releases/latest)
[![License](https://img.shields.io/github/license/zihaaaad/Chuti?color=green)](LICENSE)
[![Platform Support](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-orange)](#)
[![Offline Status](https://img.shields.io/badge/Offline-100%25%20Local-success)](#)

**Chuti** (ছুটি) is a lightweight, offline-first, local Leave Management System designed specifically for the operational needs of companies, schools, colleges, and training institutes. It provides a simple, unified interface for administrators to manage employee directories, record leave history, adjust balances, and compile payroll summary reports without requiring cloud hosting, external database servers, or an active internet connection.

---

## Key Features

*   **Local & Secure:** All data stays within your building. Information is stored in a robust SQLite database on the host machine.
*   **Multi-Mode Launcher:**
    *   **Desktop App:** Run as a standalone Windows application (`Chuti-Setup.exe` or `Chuti-Portable.exe`) with a clean user interface.
    *   **LAN sharing:** Run on one main host computer and allow all colleagues on the same office Wi-Fi or LAN to access the portal from their web browsers.
*   **Single-Admin Console:** No complex employee login flows or accounts. A single administrator manages directories, records leaves, and manages settings from one interface.
*   **Preconfigured Leave Quotas:** Built-in tracking for Casual Leave (CL - 10 days), Sick Leave (SL - 14 days), Earned Leave (EL - 15 days), and Maternity Leave (ML).
*   **Smart Business Logic:**
    *   **Sandwich Rule Toggle:** Automatically counts weekends and holidays falling within a leave range as taken leaves when enabled.
    *   **Late Attendance Deductions:** Automatically calculates and deducts Casual Leave (CL) days based on monthly late count thresholds (e.g., 3 lates = 1 CL day deducted).
    *   **Leave Encashment:** Easily log and deduct encashed Earned Leave days.
*   **Document Attachments:** Upload scans, medical certificates, or applications directly to local storage and preview them inside the app.
*   **A4 Landscape Reports:** Stylized, printer-friendly reports formatted for A4 landscape layouts (Leave Ledgers, Monthly Payroll Summaries, and Excel-compatible CSV exports).
*   **Power-Resistant Integrity:** Runs in Write-Ahead Logging (WAL) SQLite mode to prevent database corruption from sudden power cuts, and automatically schedules dated rolling backups.

---

## Installation & Usage

### Method A: Standalone Desktop App (Recommended)
No technical knowledge or pre-installed software is required.

1.  Go to the [Latest Releases](https://github.com/zihaaaad/Chuti/releases/latest) page.
2.  Download **`Chuti-Setup.exe`** (Installer) or **`Chuti-Portable.exe`** (Run from folder).
3.  Double-click the file to launch. (Windows SmartScreen may show a warning — click *More Info* -> *Run Anyway*).
4.  On first launch, choose a folder (e.g., `Documents/ChutiData`) where the system will save the database, attachments, and backups.

### Method B: Self-Hosted Server (Developers / Advanced)
If you want to run Chuti directly from source code:

#### Windows Launcher:
1.  Ensure you have **Node.js v18+** installed.
2.  Double-click **`start.bat`**.
3.  The launcher script will install dependencies, prompt you to start, and launch the portal in your browser at `http://localhost:3000`.

#### Mac / Linux manual startup:
```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Build Next.js application
npm run build

# 3. Start the LAN network server
npm run start-lan
```

---

## Default Credentials

Upon opening the login screen, enter the default admin password:
```text
admin123
```
> [!IMPORTANT]
> For security reasons, please navigate to the **Settings** panel and change your password immediately after your first login.

---

## Office LAN Sharing

Chuti is built to work as a shared portal on your local network:
1.  Launch the application on the host machine.
2.  Click the **Network URL** popup in the dashboard to see your LAN address (e.g., `http://192.168.1.100:3000`).
3.  Share this link with your coworkers. Anyone connected to the same office Wi-Fi can open the link in their web browser to access the system.
4.  *Note:* Ensure that your host machine's firewall permits incoming traffic on Port 3000.

---

## System Backups & Migration

### Automatic Backups
Chuti automatically creates a timestamped database backup in your data folder's `backups/` directory on every startup, rotating and keeping the last 30 backups to save disk space.

### Migrating to a New PC
Since the database file is completely self-contained, migrating to another computer is extremely simple:
1.  Locate your chosen **Data Folder** (containing `database.db`, `uploads/`, and `backups/`).
2.  Copy this folder to a USB drive and move it to the new computer.
3.  Launch the Chuti app on the new computer and select the copied folder as your Data Folder. All employee records, settings, and documents will load instantly.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details. Feel free to use, modify, and distribute it within your organization.
