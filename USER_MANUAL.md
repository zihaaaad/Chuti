# Welcome to Chuti Leave Management System

This guide is for administrators and HR personnel. You don't need any programming knowledge to run this system!

## How to Start the System

1. **First Time Setup**:
   - Double-click the file named `start.bat` (it might just say `start` depending on your Windows settings).
   - A black window will open. If you don't have Node.js installed, it will give you a link to download it. Install it, restart your computer, and double-click `start.bat` again.
   - The system will automatically download required files and prepare everything for you. Please be patient, this only happens once and can take a few minutes!

2. **Daily Usage**:
   - Double-click `start.bat` every time you want to start the system.
   - It will ask you to select an option. Just press `Enter` on your keyboard to choose the default [1] Start System.
   - Wait a few seconds, and it will automatically open the system in your web browser.

## Using the System on Other Computers

You don't need to install this software on every computer. You can run it on one main computer, and let others access it!

1. Start the system using `start.bat` on the main computer.
2. The black window will show a "Network Access" link (for example: `http://192.168.1.50:3000`).
3. Anyone on the same office Wi-Fi can open their web browser (on a phone, tablet, or laptop), type that link, and access the system!

## Important Notes

- **Password**: The default administrator password is `admin123`. Please change it from the Settings page after logging in.
- **Do Not Delete**: Please do not delete the `.next`, `node_modules`, `public`, or `src` folders. They are required for the system to run.
- **Backups**: The system automatically backs up your data to the `backups` folder every time you start it. If anything goes wrong, your data is safe there!
- **Updates**: If you receive a newer version of this software, replace these files, double-click `start.bat`, and type `2` to rebuild the system with the new updates.

---

*Need help? If you see a black window open but the browser doesn't open, just open Chrome or Edge and go to `http://localhost:3000`.*
