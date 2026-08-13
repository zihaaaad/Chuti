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
  - **Sandwich Rule Toggle:** Automatically calculates weekends and holidays falling within a leave range as taken leaves when enabled.
  - **Attendance Deductions:** Automatically calculates and deducts leaves based on configurable monthly late-attendance thresholds.
  - **Leave Encashment:** Easily log and deduct encashed Earned Leave days.
- **Document Management:** Upload scans, medical certificates, or applications directly to local storage for quick preview inside the application.
- **Automated Rolling Backups:** The system schedules and maintains dated rolling backups of the entire database automatically on startup.
- **Print-Ready Reporting:** Stylized, printer-friendly reports formatted specifically for A4 landscape layouts (Leave Ledgers, Monthly Payroll Summaries, and Excel-compatible CSV exports).

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
1. Ensure **Node.js v18+** is installed.
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

### Default Credentials
Upon launching the administrative dashboard, use the default credentials:
```text
admin123
```
*Note: Navigate to the Settings panel and change this password immediately after your first login.*

### Office LAN Sharing
To deploy Chuti across your local office network:
1. Launch the application on the designated host machine.
2. Click the **Network URL** indicator in the dashboard to view your LAN address (e.g., `http://192.168.1.100:3000`).
3. Distribute this URL to authorized personnel. Ensure your host machine's firewall allows inbound TCP traffic on Port 3000.

---

## Data Migration & Recovery

### Restoring Backups
Chuti maintains a rolling 30-day backup history. To restore:
1. Navigate to the **Settings** panel.
2. Locate the **Restore Backup** module.
3. Select a timestamped backup. The system will automatically create a snapshot of your current state before rolling back, ensuring zero data loss if a mistake is made.

### Hardware Migration
Migrating to new hardware is entirely frictionless:
1. Locate your selected **Data Folder** (which contains `database.db`, the `uploads/` directory, and `backups/`).
2. Transfer this entire folder to the new hardware via USB or network transfer.
3. Launch Chuti on the new machine and point it to the copied directory. All records and configurations will resume instantly.

---

## License & Open Source

This project is licensed under the **MIT License**. See the `LICENSE` file for details. You are encouraged to utilize, modify, and distribute this software within your organization.
