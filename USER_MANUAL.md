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

> [!TIP]
> **Getting a *new version* of the code (not just Option 2's rebuild) is different from updating.** In this Network Launcher mode, your database, uploads, and backups live directly inside this project folder — there's no separate data folder like the desktop app uses. If you download a new copy of the project to update it, copy `database.db`, `uploads/`, and `backups/` out of your current folder first, put the new code in a *different* folder, and copy those three items into it before starting it up. If you delete your old folder and unpack a fresh download in its place without doing this, you will start with an empty database — a fresh download never includes your existing records.

---

## Office LAN Sharing (Accessing from other PCs)

You only need to install and run the application on **one host computer** (for example, the HR administrator's computer). Other computers, tablets, or smartphones connected to the same office Wi-Fi can access the portal instantly:

1.  On the host computer, choose **Network → Allow Access from Other Computers** in the Chuti menu. Chuti restarts. (New installations start with this turned off, so nobody else on the network can reach the sign-in page until you decide.)
2.  Choose **Network → Copy LAN URL to Clipboard** to get the address (for example, `http://192.168.1.100:3000`).
3.  Have colleagues open their web browsers and type that URL into the address bar.
4.  *Note:* If other devices cannot load the page, check the host computer's **Windows Firewall** settings and ensure incoming requests on that port are allowed.
5.  Only share on a trusted office network, and use a strong admin password. To stop sharing, untick the same menu item.
6.  Running from `start.bat`? Answer **Y** when it asks "Allow network access?".

---

## Core Administration Tasks

### Setting up the Password
*   A new installation starts with the password **`admin123`**.
*   On first sign-in, Chuti asks you to replace it before you can continue. Use at least 8 characters.
*   Change it later in **Settings → Admin password**. This signs out every other browser.

### Managing Employee Directories
*   **Manual Entry:** Go to **Employees** -> **Add Employee**. Fill in their ID code, name, designation, joining date, and select their department. Phone number and email are optional contact fields.
*   **Custom Quotas:** You can configure custom yearly quotas (Casual Leave, Sick Leave, Earned Leave) for each employee profile.
*   **Bulk CSV Import:** To import many employees at once, click **Download Template CSV** on the Employees page, fill in the columns using Microsoft Excel or Google Sheets, and click **Upload Employees from CSV**. The template has seven columns — EmployeeID, Name, Designation, Department, Phone, JoiningDate, and Email — where Email is optional and can be left blank. Older template files saved before Email was added (six columns) still import correctly.

### Recording Leaves
1.  Go to **Leave records** → **Record leave**.
2.  Search for the employee by name or ID, then choose the leave type and dates.
3.  Check the preview: it shows the days that will be charged and the balance before and after.
4.  **Half days:** Tick **Half day**; only one date is needed.
5.  **Attachments:** Upload a scanned certificate or application (PDF, image or Word, up to 10 MB).

### Employee Statements
Click an employee's name anywhere in Chuti to open their page: balances, every leave, encashment and late-arrival cut, and a **Print statement** button.

### Closing the Leave Year
At year end, open **Settings → Leave year → Close leave year**. Chuti saves a backup, carries unused Earned Leave forward up to the cap, lets unused CL/SL/ML lapse, and makes the closed year's records read-only.

---

## Backups & Data Security

*   **WAL Mode Safeguards:** Chuti runs the local SQLite database in WAL (Write-Ahead Logging) mode, which protects the database if the computer loses power.
*   **Backup copies (recommended):** In **Settings → Backup copies**, choose **Choose backup folder…** on the computer running Chuti. Pick a USB drive, a second disk, or a Google Drive / OneDrive folder that syncs to the cloud. Chuti then saves a complete copy — database **and** attachments — every day at the time you set, and keeps the newest copies (30 by default). **Back up now** makes one immediately. The Overview page warns you if copies stop working, for example when the USB drive is unplugged.
*   **Restoring a backup copy:** **Settings → Backup copies → Restore** next to a copy. Chuti checks the file for damage, saves a copy of your current data first, and puts the attachments back. To move to a new computer, install Chuti there, choose the same backup folder, and restore the newest copy.
*   **Quick restore points:** Chuti also keeps database-only snapshots inside its own data folder, on every start-up and every 12 hours (latest 30). Restore them from **Settings → Quick restore points**. They live on the same drive as your data, so they are not a replacement for backup copies.
*   **Protecting copies with a backup password (strongly recommended):** Before saving the first copy, Chuti asks you to choose. Select **Set a backup password** (at least 12 characters; a short sentence is ideal; not the admin password). Chuti then shows a **recovery code** once. Print it or write it down and keep it with important papers, not in the backup folder or the same cloud account. Every copy is then encrypted: someone who gets into your Google Drive / OneDrive or finds the USB drive cannot read it without the password or the recovery code.
*   **After restarting Chuti** on the host computer, protected copies keep working automatically. If Settings says **Locked** (for example after moving to a new Windows account), choose **Unlock with password**.
*   **Restoring a protected copy** asks for the backup password or the recovery code. Copies made before a password change need the old password, or the recovery code, which never changes.
*   **Lost both the password and the recovery code?** Protected copies cannot be opened by anyone, including Chuti's developers. Keep the recovery code safe.
*   Choosing **Save without a password** is possible, but anyone who gets a copy can read all staff data and attachments. If your backup folder syncs to the cloud, Chuti asks you to type `NO PASSWORD` to confirm.
*   **Keep Chuti's data folder out of OneDrive, Google Drive and Dropbox.** Windows often puts "Documents" inside OneDrive. Chuti warns you if the data folder is synced, because the live database would be uploaded unencrypted and can be damaged by syncing. Use a local folder such as `C:\ChutiData`, and let Backup copies put encrypted copies in the cloud.
*   **Balance check:** **Settings → Balance check** recalculates every balance from the leave records and fixes mismatches.
*   **Activity log:** Every change is listed under **Activity log** with its time and the device that made it.

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
