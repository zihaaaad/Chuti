'use strict';

/**
 * Chuti Leave Management System — Electron Main Process
 *
 * Responsibilities:
 *  1. On first launch: show a native folder-picker dialog so the user selects
 *     where the database, backups, and uploads will live (their "data folder").
 *  2. Save that choice to %APPDATA%/Chuti/config.json so it is remembered.
 *  3. Find a free TCP port (start at 3000, walk up if occupied).
 *  4. Spawn the Next.js production server as a child process, injecting
 *     APP_DATA_DIR, PORT, and HOSTNAME environment variables.
 *  5. Wait until the server is ready, then open the main BrowserWindow.
 *  6. Display the LAN IP address so the admin knows what URL to share.
 *  7. Guarantee clean shutdown — kill the child process when the window closes.
 */

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const net   = require('net');
const os    = require('os');
const http  = require('http');
const { spawn } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_NAME       = 'Chuti';
const CONFIG_DIR     = path.join(app.getPath('appData'), APP_NAME);
const CONFIG_FILE    = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE       = path.join(CONFIG_DIR, 'app.log');
const STARTING_PORT  = 3000;
const READY_TIMEOUT  = 60_000; // 60 s

// ─── Globals ──────────────────────────────────────────────────────────────────
let mainWindow  = null;
let serverProc  = null;
let appPort     = STARTING_PORT;
let dataDir     = null;
let tray        = null;
let isQuitting  = false;

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}

// ─── Config helpers ───────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const cfg = JSON.parse(raw);
      if (cfg.dataDir && fs.existsSync(cfg.dataDir)) return cfg;
    }
  } catch (e) {
    log(`Config read error: ${e.message}`);
  }
  return null;
}

function saveConfig(cfg) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    log(`Config write error: ${e.message}`);
  }
}

// ─── Free-port finder ─────────────────────────────────────────────────────────
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    function tryPort() {
      const srv = net.createServer();
      srv.once('error', () => { port += 1; tryPort(); });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, '0.0.0.0');
    }

    if (port > startPort + 100) {
      reject(new Error('Could not find a free port in range 3000–3100'));
    } else {
      tryPort();
    }
  });
}

// ─── LAN IP helper ────────────────────────────────────────────────────────────
function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── Wait-for-server ──────────────────────────────────────────────────────────
function waitForServer(port, timeout) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    function poll() {
      http.get(`http://localhost:${port}/`, (res) => {
        // Any HTTP response means the server is up
        resolve();
      }).on('error', () => {
        if (Date.now() > deadline) return reject(new Error('Server did not start in time'));
        setTimeout(poll, 500);
      });
    }

    poll();
  });
}

// ─── Folder-picker dialog ─────────────────────────────────────────────────────
async function pickDataFolder(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow || null, {
    title: 'Select Chuti Data Folder',
    message: 'Choose a folder where Chuti will store the database, backups, and uploaded files.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use This Folder',
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

// ─── Spawn Next.js server ─────────────────────────────────────────────────────
function spawnServer(port, appDataDir) {
  // In production (packaged app), the standalone server lives in resources/
  // In development, we run `next start` via npm.
  const isProd = app.isPackaged;

  let serverPath, args, cwd;

  if (isProd) {
    // electron-builder places extraResources at process.resourcesPath
    serverPath = path.join(process.resourcesPath, 'server', 'server.js');
    args       = [serverPath];
    cwd        = path.join(process.resourcesPath, 'server');
  } else {
    // Development: use `node_modules/.bin/next start`
    serverPath = process.execPath; // node
    const nextBin = path.join(__dirname, 'node_modules', '.bin', 'next');
    args = [nextBin, 'start', '-p', String(port), '-H', '0.0.0.0'];
    cwd  = __dirname;
  }

  const env = {
    ...process.env,
    PORT:         String(port),
    HOSTNAME:     '0.0.0.0',
    APP_DATA_DIR: appDataDir,
    NODE_ENV:     'production',
  };

  log(`Spawning server: ${serverPath} ${args.slice(1).join(' ')}`);
  log(`APP_DATA_DIR: ${appDataDir}  PORT: ${port}`);

  const proc = isProd
    ? spawn(process.execPath, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.execPath, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stdout.on('data', (d) => log(`[server] ${d.toString().trim()}`));
  proc.stderr.on('data', (d) => log(`[server ERR] ${d.toString().trim()}`));
  proc.on('exit', (code) => {
    log(`Server exited with code ${code}`);
    if (!isQuitting && mainWindow) {
      mainWindow.webContents.loadURL(`data:text/html,<h1 style="font-family:sans-serif;padding:2rem;color:#c00">The Chuti server stopped unexpectedly (code ${code}).<br>Please restart the application.</h1>`);
    }
  });

  return proc;
}

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow(port) {
  const lanIP = getLanIP();

  mainWindow = new BrowserWindow({
    width:           1280,
    height:          820,
    minWidth:        900,
    minHeight:       600,
    show:            false,
    title:           'Chuti — Leave Management',
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'public', 'icon.png'),
  });

  // Build and set application menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Data Folder…',
          click: async () => {
            const chosen = await pickDataFolder(mainWindow);
            if (chosen) {
              const cfg = loadConfig() || {};
              cfg.dataDir = chosen;
              saveConfig(cfg);
              dialog.showMessageBox(mainWindow, {
                type:    'info',
                title:   'Data Folder Changed',
                message: `Data folder updated to:\n${chosen}\n\nThe application will now restart.`,
                buttons: ['Restart Now'],
              }).then(() => { app.relaunch(); app.quit(); });
            }
          },
        },
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(dataDir),
        },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Network',
      submenu: [
        {
          label: `LAN Access URL: http://${lanIP}:${port}`,
          enabled: false,
        },
        {
          label: 'Copy LAN URL to Clipboard',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(`http://${lanIP}:${port}`);
          },
        },
        { type: 'separator' },
        {
          label: 'Open in Browser',
          click: () => shell.openExternal(`http://localhost:${port}`),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'View Log File',
          click: () => shell.openPath(LOG_FILE),
        },
        {
          label: 'About Chuti',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'About Chuti',
              message: 'Chuti — Leave Management System\nVersion 1.0.0\n\nA lightweight, offline-first leave management system for small organisations.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Show LAN info overlay as a notification-style dialog once on first load
    const lanURL = `http://${lanIP}:${port}`;
    dialog.showMessageBox(mainWindow, {
      type:    'info',
      title:   'Chuti is Running',
      message: `✅  Application started successfully!\n\n📡  Network URL for staff:\n     ${lanURL}\n\n💾  Data folder:\n     ${dataDir}\n\nShare the Network URL with your team members on the same Wi-Fi.`,
      buttons: ['OK — Let me work!'],
      icon: fs.existsSync(path.join(__dirname, 'public', 'icon.png'))
        ? path.join(__dirname, 'public', 'icon.png')
        : undefined,
    }).catch(() => {});
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Intercept external link clicks — open them in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

// ─── Splash / loading window ──────────────────────────────────────────────────
function createSplash() {
  const splash = new BrowserWindow({
    width:           460,
    height:          280,
    frame:           false,
    alwaysOnTop:     true,
    resizable:       false,
    transparent:     false,
    backgroundColor: '#0f172a',
    skipTaskbar:     true,
    webPreferences: { nodeIntegration: false },
  });

  splash.loadURL(`data:text/html;charset=utf-8,<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #0f172a;
    color: #e2e8f0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 24px;
  }
  .logo { font-size: 52px; }
  h1   { font-size: 28px; font-weight: 700; color: #38bdf8; letter-spacing: 1px; }
  p    { font-size: 14px; color: #94a3b8; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid #1e3a5f;
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="logo">🌴</div>
  <h1>Chuti</h1>
  <p>Starting the server, please wait…</p>
  <div class="spinner"></div>
</body>
</html>`);

  return splash;
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log('App ready. Starting initialization…');

  // Show splash immediately
  const splash = createSplash();

  try {
    // 1. Load or request data folder
    let cfg = loadConfig();

    if (!cfg) {
      log('No valid config found — showing folder picker.');

      // Need a dummy window for the dialog to be modal
      const pickerWin = new BrowserWindow({ show: false });

      const chosen = await pickDataFolder(pickerWin);
      pickerWin.destroy();

      if (!chosen) {
        dialog.showErrorBox('Setup Required', 'You must select a data folder to use Chuti.\nThe application will now exit.');
        app.quit();
        return;
      }

      cfg = { dataDir: chosen };
      saveConfig(cfg);
      log(`Data folder selected: ${chosen}`);
    }

    dataDir = cfg.dataDir;

    // Ensure all required sub-directories exist
    for (const sub of ['uploads', 'backups']) {
      const dir = path.join(dataDir, sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // 2. Find a free port
    appPort = await findFreePort(STARTING_PORT);
    log(`Using port ${appPort}`);

    // 3. Start Next.js server
    serverProc = spawnServer(appPort, dataDir);

    // 4. Wait for server to be ready
    log('Waiting for server to be ready…');
    await waitForServer(appPort, READY_TIMEOUT);
    log('Server is ready.');

    // 5. Open main window, close splash
    createWindow(appPort);
    splash.destroy();

  } catch (err) {
    log(`Fatal startup error: ${err.message}`);
    splash.destroy();
    dialog.showErrorBox('Chuti failed to start', `${err.message}\n\nPlease check the log file:\n${LOG_FILE}`);
    app.quit();
  }
});

// ─── Shutdown guard ───────────────────────────────────────────────────────────
function killServer() {
  if (serverProc && !serverProc.killed) {
    log('Killing server process…');
    try {
      // On Windows, taskkill ensures the entire process tree is terminated
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /PID ${serverProc.pid} /T /F`);
      } else {
        serverProc.kill('SIGTERM');
      }
    } catch (e) {
      log(`Error killing server: ${e.message}`);
      try { serverProc.kill('SIGKILL'); } catch (_) {}
    }
    serverProc = null;
  }
}

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', killServer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && appPort) {
    createWindow(appPort);
  }
});

// ─── IPC handlers (for future preload bridge) ─────────────────────────────────
ipcMain.handle('get-lan-url', () => `http://${getLanIP()}:${appPort}`);
ipcMain.handle('get-data-dir', () => dataDir);
ipcMain.handle('get-port',     () => appPort);
ipcMain.handle('open-data-dir', () => shell.openPath(dataDir));
