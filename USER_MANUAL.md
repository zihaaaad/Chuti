# Chuti User Manual & Administration Guide

Welcome to the **Chuti Leave Management System**! This guide is designed for administrators, HR coordinators, and school/institute managers. You do **not** need any programming or database experience to run, manage, or migrate this system.

---

## How to Run the System

### Standard Desktop Application (Recommended)
1.  **Start:** Double-click the **Chuti** desktop icon or application file (`Chuti.exe`).
2.  **Data Folder Setup (First Launch Only):**
    *   On the first launch, the app will ask you to select a **Data Folder**.
    *   Create or select a folder on your computer (for example, `Documents/ChutiData`).
    *   This folder will store your database (`database.db`), uploaded files (`uploads/`), and automated backups.
3.  **Use:** The graphical user interface will open. Log in and manage the records.

### Network Launcher (Self-Hosted Node Server)
If you are running the system via the code files on Windows:
1.  **Start:** Double-click **`start.bat`**.
2.  **Rebuilds & Updates:** If files are updated, select **Option 2** (Rebuild System) on startup. Otherwise, press **Enter** (Option 1) to launch immediately.
3.  **Local Address:** The system will open your web browser automatically at `http://localhost:3000`.

---

## Office LAN Sharing (Accessing from other PCs)

You only need to install and run the application on **one host computer** (for example, the HR administrator's computer). Other computers, tablets, or smartphones connected to the same office Wi-Fi can access the portal instantly:

1.  Keep the Chuti application running on the host computer.
2.  Locate the **Network URL** displayed on the console overview dashboard (for example, `http://192.168.1.100:3000`).
3.  Have colleagues open their web browsers and type that URL into the address bar.
4.  *Note:* If other devices cannot load the page, check the host computer's **Windows Firewall** settings and ensure incoming requests on Port 3000 are allowed.

---

## Core Administration Tasks

### Setting up the Password
*   The default password is **`admin123`**.
*   Change this immediately by navigating to **Console** -> **Settings** -> **Change Password**.

### Managing Employee Directories
*   **Manual Entry:** Go to **Employees** -> **Add Employee**. Fill in their ID code, name, designation, joining date, and select their department.
*   **Custom Quotas:** You can configure custom yearly quotas (Casual Leave, Sick Leave, Earned Leave) for each employee profile.
*   **Bulk CSV Import:** To import many employees at once, click **Download Template CSV** on the Employees page, fill in the columns using Microsoft Excel or Google Sheets, and click **Upload Employees from CSV**.

### Recording Leaves
1.  Go to **Leave Records** -> **Record A Leave**.
2.  Select the employee, leave type, start/end dates, and state the reason.
3.  **Attachments:** If you have a scanned medical certificate or physical application form, click the **Attachment** field to upload the document.
4.  **Half-Days:** Check the **Is Half Day** option for half-day logs. The system automatically restricts the end date to match the start date.

---

## Backups & Data Security

*   **WAL Mode Safeguards:** Chuti runs the local SQLite database in WAL (Write-Ahead Logging) mode. This actively prevents database corruption even if the host computer shuts down suddenly due to a power outage.
*   **Auto-Backups:** The app automatically backs up your database to the `backups/` directory inside your chosen data folder every time it starts up. The system retains the last **30 backups** and deletes older ones to save disk space.
*   **Manual Backups:** You can copy the `database.db` file from your data folder to a secure cloud drive or external backup drive at any time.

---

## PC Migration Guide

To transfer your entire leave records history, settings, and uploaded files to a new computer:

1.  Install the Chuti application (or copy the project folder) on the new computer.
2.  Locate the **Data Folder** on your current computer (the one you chose on first launch).
3.  Copy this entire folder (using a USB drive or local network) to the new computer.
4.  Open the Chuti application on the new computer.
5.  When prompted, select the folder you just copied as the **Data Folder**. The system will load all historical data, settings, and documents instantly.

---

> [!TIP]
> If you close the browser window but need to access the console again while the application is running, open any web browser (Chrome, Edge, Safari) and go to `http://localhost:3000` or your LAN network URL.
