# Chuti - Leave Management System

Chuti is a lightweight, offline-first, local Leave Management System designed specifically for the operational needs of companies, schools, colleges, and training institutes. 

The system runs locally on a single host computer (such as at the administrator or HR desk), stores all records securely in a local database, and allows other computers on the same local network (Wi-Fi or LAN) to access the portal without requiring external cloud hosting or internet access.

---

## Key Features

- **Single-Administrator Console**: No employee login accounts are required. A single administrator manages all employee profiles, records leave applications, and configures policy rules from one secure interface.
- **Preconfigured Leave Quotas**: Built-in support for Casual Leave (CL - 10 days), Sick Leave (SL - 14 days), Earned Leave (EL - 15 days), and Maternity Leave (ML).
- **Sandwich Rule Toggle**: Enable or disable the sandwich rule according to company policy. When enabled, weekends and holidays falling within a leave range are counted as leave days.
- **Late Attendance Deductions**: Automatically calculates and deducts Casual Leave (CL) days based on monthly late attendance counts (for example, deducting 1 CL day for every 3 late attendances).
- **Leave Encashment & Unpaid Leave (LWP)**: Log Earned Leave encashment details and track Leave Without Pay (LWP) days, which automatically deduct from net paid days in payroll summaries.
- **Local Document Previews and Uploads**: Scan and upload leave applications, medical documents, or certificates directly to local storage. View photos and PDFs inline inside the application using a built-in preview modal.
- **A4 Landscape Reports and CSV Exports**:
  - **Leave Ledger Log**: A detailed log of historical leave applications.
  - **Payroll Attendance Summary**: A monthly collated summary calculating total leaves, late counts, deducted CL, and net paid days.
  - **A4 Landscape PDF Printing**: Styled with print-specific media queries to hide sidebars, filter tools, and buttons, formatting the tables for A4 landscape paper.
  - **CSV Spreadsheet Exports**: Download reports in CSV format for importing into Excel or accounting software.
- **Data Integrity and Auto-Backups**: The SQLite database runs in Write-Ahead Logging (WAL) mode to protect data from corruption during sudden power failures. The launcher script automatically creates a dated backup inside the backups directory every time it starts up.

---

## System Requirements

The host computer must have Node.js installed to run the application server:
- Node.js (Version 18 or higher is recommended)
- Available download: https://nodejs.org

---

## Installation and Startup on Windows

1. Download and extract this project folder to your desired directory (for example, Desktop or Documents).
2. Double-click the launcher script named `start.bat`.
3. The launcher will run the following operations:
   - Check if Node.js is installed on your system.
   - Install all required software dependencies during the first-time startup.
   - Prompt you to select a startup mode: Enter 1 for Production Mode (optimized, fast, and recommended) or 2 for Developer Mode.
   - Automatically compile the application files and open your web browser to http://localhost:3000.
4. Log in using the default administrator password:
   ```
   admin123
   ```
   Note: It is highly recommended to change this password immediately in the Settings panel.

---

## Startup on Mac or Linux

Open your Terminal in the project directory and execute the following commands:

```bash
# 1. Install dependencies
npm install

# 2. Compile application files for production
npm run build

# 3. Start the server on the local network interface
npm run start-lan
```

Once started, open your web browser and go to: http://localhost:3000

---

## Network Sharing (LAN Access)

Since the server binds to all local network interfaces (0.0.0.0), other computers or mobile devices connected to the same office Wi-Fi or local network can access the portal.

1. When you run `start.bat`, the console automatically detects and displays your local network IP address (for example, http://192.168.1.100:3000).
2. Ensure that your host computer's Windows Defender Firewall allows incoming traffic on Port 3000.
3. Open the web browser on any device connected to the same network and enter the displayed network URL.

---

## Upgrades and Updates

When updating the software or pulling new code changes from GitHub, your local data remains secure:

1. Open Command Prompt in the project folder and pull the latest changes:
   ```bash
   git pull origin main
   ```
2. Run `start.bat` to rebuild the project.

Note: The local database file (`database.db`), local backups (`/backups`), and uploaded attachments (`/public/uploads`) are specified inside the `.gitignore` file. Pulling updates from Git will safely update the application features without overwriting, modifying, or losing any of your employees, historical records, settings, or uploaded files. Database schema migrations run automatically on startup.

---

## PC Migration Guide

To move your entire leave management system, database history, and uploaded files to a new computer:

1. Locate the project folder (`LeaveManagementSystem`) on the current host computer.
2. Compress the entire folder into a `.zip` archive file. Ensure that the local database file `database.db` and the `/public/uploads` directory are included in the archive.
3. Transfer the `.zip` archive to the new computer using a USB drive, external hard drive, or local network transfer.
4. Extract the `.zip` archive on the new computer.
5. Install Node.js on the new computer from https://nodejs.org.
6. Double-click the `start.bat` launcher on the new computer. The script will automatically install dependencies, initialize, and open the system with all your employee records, quotas, settings, and documents intact.

---

## License

This project is licensed under the terms of the MIT License. You are free to modify, distribute, and utilize it within your organization.
