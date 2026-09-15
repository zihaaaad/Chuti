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

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage, safeStorage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const net   = require('net');
const os    = require('os');
const http  = require('http');
const { spawn } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_NAME       = 'Chuti';
// CHUTI_CONFIG_DIR relocates Chuti's own config, log, key store and Electron
// profile (portable setups, and running a test copy without touching a real install).
const CONFIG_DIR     = process.env.CHUTI_CONFIG_DIR || path.join(app.getPath('appData'), APP_NAME);
if (process.env.CHUTI_CONFIG_DIR) app.setPath('userData', path.join(CONFIG_DIR, 'profile'));
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
// Per-launch secret for the server's internal routes (e.g. choosing the backup
// folder). Only this process and the server it starts know it.
const INTERNAL_TOKEN = require('crypto').randomBytes(32).toString('hex');

// ─── Single-instance lock ──────────────────────────────────────────────────────
// Without this, double-clicking the desktop shortcut twice (or running the
// portable EXE alongside the installed version, pointed at the same data
// folder) spawns two independent Next.js server processes that each open
// their own SQLite connection and independently run the startup migration
// sequence against the same database.db — a real risk of two processes
// racing the DROP TABLE + RENAME steps in db.ts against each other.
// requestSingleInstanceLock() ensures only the first launch actually starts
// a server; any later launch attempt just focuses the first window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // Another instance already owns the lock — hand off to it and exit
  // immediately, before any server/window/config logic below runs.
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to launch a second copy — surface the existing window
    // instead of letting a second server process start.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

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
function findFreePort(startPort, host) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    function tryPort() {
      if (port > startPort + 100) {
        return reject(new Error('Could not find a free port in range 3000–3100'));
      }
      const srv = net.createServer();
      srv.once('error', () => { port += 1; tryPort(); });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, host);
    }

    tryPort();
  });
}

// ─── Network exposure ─────────────────────────────────────────────────────────
// By default the server listens only on this computer (127.0.0.1). Sharing with
// colleagues over the office network is an explicit choice in the Network menu.
// Installs that existed before this setting keep LAN access on, so updating
// never cuts an office off without warning.
function lanAccessEnabled(cfg) {
  return !!(cfg && cfg.lanAccess);
}

function bindHost(cfg) {
  return lanAccessEnabled(cfg) ? '0.0.0.0' : '127.0.0.1';
}

async function setLanAccess(enabled) {
  if (enabled) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Allow access from other computers?',
      message: 'Anyone on this network will be able to open the Chuti sign-in page.',
      detail: 'They still need the admin password, which gives full access to all staff records. Before turning this on, make sure the admin password is long and not shared, and only use trusted networks (not public Wi-Fi).\n\nChuti will restart to apply the change.',
      buttons: ['Allow and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  } else {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Stop network access?',
      message: 'Only this computer will be able to use Chuti. Colleagues using the network address will be disconnected.',
      buttons: ['Stop and restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  saveConfig({ ...(loadConfig() || {}), lanAccess: enabled });
  log(`LAN access ${enabled ? 'enabled' : 'disabled'}; restarting`);
  app.relaunch();
  app.quit();
}

// ─── LAN IP helper ────────────────────────────────────────────────────────────
function getLanIP() {
  const ifaces = os.networkInterfaces();
  const ignorePatterns = [/vEthernet/i, /VirtualBox/i, /VMware/i, /WSL/i];
  
  for (const name of Object.keys(ifaces)) {
    if (ignorePatterns.some(p => p.test(name))) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  
  // Fallback if all external interfaces match ignore patterns
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

// ─── External links ───────────────────────────────────────────────────────────
function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch (_) {
    return false;
  }
}

// ─── Auto-update ──────────────────────────────────────────────────────────────
// Uses the GitHub releases electron-builder already publishes. Only the
// installed (NSIS) build can update itself; the portable EXE is skipped.
// The database is backed up by the app on every start, so an update that
// runs a migration always has a restore point.
function checkForUpdates(userInitiated = false) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
    if (userInitiated) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Updates',
        message: 'The portable version cannot update itself. Download the latest version from the GitHub releases page.',
      }).catch(() => {});
    }
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log(`electron-updater unavailable: ${e.message}`);
    return;
  }
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.removeAllListeners();
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `Chuti ${info.version} has been downloaded.`,
      detail: 'It will be installed the next time you close Chuti. Restart now to install it immediately.',
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
    }).then(({ response }) => {
      if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall(); }
    }).catch(() => {});
  });
  if (userInitiated) {
    autoUpdater.once('update-not-available', () => {
      dialog.showMessageBox(mainWindow, { type: 'info', title: 'Updates', message: `You have the latest version (${app.getVersion()}).` }).catch(() => {});
    });
    autoUpdater.once('error', (err) => {
      dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Updates', message: 'Could not check for updates.', detail: err ? err.message : '' }).catch(() => {});
    });
  }
  autoUpdater.checkForUpdates().catch((err) => log(`Update check failed: ${err.message}`));
}

// ─── Folder-picker dialog ─────────────────────────────────────────────────────
// Keep in sync with src/lib/sync-folders.ts (the server shows the same warning in Settings).
function cloudSyncProvider(folder) {
  const lower = path.resolve(folder).toLowerCase();
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[key];
    if (root && (lower === path.resolve(root).toLowerCase() || lower.startsWith(path.resolve(root).toLowerCase() + path.sep))) return 'OneDrive';
  }
  const patterns = [
    [/^onedrive( - .+)?$/i, 'OneDrive'], [/^(google drive|googledrive|my drive|shared drives)$/i, 'Google Drive'],
    [/^dropbox( \(.+\))?$/i, 'Dropbox'], [/^(icloud ?drive|icloud)$/i, 'iCloud Drive'], [/^box( sync)?$/i, 'Box'],
  ];
  for (const segment of path.resolve(folder).split(/[\\/]+/)) {
    for (const [re, name] of patterns) if (re.test(segment)) return name;
  }
  return null;
}

async function pickDataFolder(parentWindow) {
  for (;;) {
    const result = await dialog.showOpenDialog(parentWindow || null, {
      title: 'Select Chuti Data Folder',
      message: 'Choose a folder on this computer where Chuti will store the database, backups, and uploaded files.',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Use This Folder',
    });
    if (result.canceled || !result.filePaths.length) return null;
    const chosen = result.filePaths[0];

    // A live SQLite database must not sit in a cloud-synced folder: the sync
    // client uploads it unencrypted, and syncing its WAL files can corrupt it.
    const provider = cloudSyncProvider(chosen);
    if (!provider) return chosen;
    const { response } = await dialog.showMessageBox(parentWindow || null, {
      type: 'warning',
      title: 'This folder is synced to the cloud',
      message: `This folder is synced to ${provider}.`,
      detail: `Chuti's live database, including staff details and medical attachments, would be uploaded to ${provider} unencrypted, and syncing a database that is in use can corrupt it.\n\nChoose a local folder such as C:\\ChutiData instead. To keep a copy in ${provider}, use Settings → Backup copies, which can encrypt the copies.`,
      buttons: ['Choose another folder', 'Use it anyway'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) {
      log(`Data folder inside ${provider} chosen despite warning: ${chosen}`);
      return chosen;
    }
  }
}

// ─── Spawn Next.js server ─────────────────────────────────────────────────────
function spawnServer(port, appDataDir, host) {
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
    // The real Node entry point: node_modules/.bin/next is a shell shim on Windows.
    const nextBin = require.resolve('next/dist/bin/next', { paths: [__dirname] });
    args = [nextBin, 'start', '-p', String(port), '-H', host];
    cwd  = __dirname;
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT:         String(port),
    HOSTNAME:     host,
    APP_DATA_DIR: appDataDir,
    NODE_ENV:     'production',
    CHUTI_INTERNAL_TOKEN: INTERNAL_TOKEN,
    CHUTI_APP_VERSION:    app.getVersion(),
  };

  log(`Spawning server: ${serverPath} ${args.slice(1).join(' ')}`);
  log(`APP_DATA_DIR: ${appDataDir}  PORT: ${port}`);

  const proc = spawn(process.execPath, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });

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
  const lanOn = lanAccessEnabled(loadConfig());

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
        // Developer tools only when running from source.
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
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
          label: 'Allow Access from Other Computers',
          type: 'checkbox',
          checked: lanOn,
          click: () => setLanAccess(!lanOn),
        },
        { type: 'separator' },
        ...(lanOn
          ? [
              { label: `LAN Access URL: http://${lanIP}:${port}`, enabled: false },
              {
                label: 'Copy LAN URL to Clipboard',
                click: async () => {
                  // clipboard methods return Promises since Electron 40.
                  try {
                    await require('electron').clipboard.writeText(`http://${lanIP}:${port}`);
                  } catch (e) {
                    log(`Clipboard write failed: ${e.message}`);
                  }
                },
              },
            ]
          : [{ label: 'Only this computer can use Chuti', enabled: false }]),
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
          label: 'Check for Updates…',
          enabled: app.isPackaged,
          click: () => checkForUpdates(true),
        },
        {
          label: 'About Chuti',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'About Chuti',
              message: `Chuti — Leave Management System\nVersion ${app.getVersion()}\n\nOffline-first leave management for small organisations.\n\nData folder:\n${dataDir}`,
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

    // Explain LAN sharing once, on the first launch only. The URL stays
    // available under Network in the menu afterwards.
    const cfg = loadConfig() || {};
    if (!cfg.welcomeShown) {
      const lanURL = `http://${lanIP}:${port}`;
      dialog.showMessageBox(mainWindow, {
        type:    'info',
        title:   'Chuti is running',
        message: 'Chuti is ready.',
        detail:  lanOn
          ? `Colleagues on the same network can open:\n${lanURL}\n\nYour data is stored in:\n${dataDir}\n\nYou can find both again under Network and Help in the menu.`
          : `For safety, only this computer can use Chuti. To let colleagues on the office network use it, choose Network → Allow Access from Other Computers.\n\nYour data is stored in:\n${dataDir}`,
        buttons: ['OK'],
      }).catch(() => {});
      saveConfig({ ...cfg, welcomeShown: true });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Only ever hand http(s) links to the OS. Anything else (file:, javascript:,
  // custom protocol handlers) is refused so page content can't launch programs.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.hostname !== 'localhost' || target.port !== String(port)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    }
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

      // New installs start with network access off.
      cfg = { dataDir: chosen, lanAccess: false };
      saveConfig(cfg);
      log(`Data folder selected: ${chosen}`);
    }

    // Installs from before the network setting existed keep LAN access on.
    if (cfg.lanAccess === undefined) {
      cfg.lanAccess = !!cfg.welcomeShown || fs.existsSync(path.join(cfg.dataDir, 'database.db'));
      saveConfig(cfg);
    }
    const host = bindHost(cfg);
    log(`Network access: ${cfg.lanAccess ? 'LAN (0.0.0.0)' : 'this computer only (127.0.0.1)'}`);

    dataDir = cfg.dataDir;

    // Ensure all required sub-directories exist
    for (const sub of ['uploads', 'backups']) {
      const dir = path.join(dataDir, sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // 2. Find a free port
    appPort = await findFreePort(STARTING_PORT, host);
    log(`Using port ${appPort}`);

    // 3. Start Next.js server
    if (app.isPackaged) {
      log('Starting Next.js server in-process (production)…');
      process.env.PORT = String(appPort);
      process.env.HOSTNAME = host;
      process.env.APP_DATA_DIR = dataDir;
      process.env.NODE_ENV = 'production';
      process.env.CHUTI_INTERNAL_TOKEN = INTERNAL_TOKEN;
      process.env.CHUTI_APP_VERSION = app.getVersion();
      
      // Set NODE_PATH so the out-of-asar server.js can resolve dependencies in app.asar/node_modules
      const appNodeModules = path.join(__dirname, 'node_modules');
      process.env.NODE_PATH = process.env.NODE_PATH
        ? `${process.env.NODE_PATH}${path.delimiter}${appNodeModules}`
        : appNodeModules;
      require('module')._initPaths();
      
      const serverPath = path.join(process.resourcesPath, 'server', 'server.js');
      log(`Loading server module: ${serverPath}`);
      require(serverPath);
    } else {
      log('Spawning Next.js server (development)…');
      serverProc = spawnServer(appPort, dataDir, host);
    }

    // 4. Wait for server to be ready
    log('Waiting for server to be ready…');
    await waitForServer(appPort, READY_TIMEOUT);
    log('Server is ready.');

    // 5. Re-arm the backup encryption key so scheduled copies keep working.
    await loadBackupKeyIntoServer();

    // 6. Cloud backups run on their own schedule once an account is connected.
    cloudService().start();

    // 7. Open main window, close splash
    createWindow(appPort);
    splash.destroy();

    // 8. Look for updates in the background (never blocks startup, silent offline).
    setTimeout(() => checkForUpdates(false), 15_000);

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

// ─── IPC handlers (preload bridge) ────────────────────────────────────────────
// Only the app's own window, showing the local server, may call these.
function fromAppWindow(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.hostname === 'localhost' && url.port === String(appPort);
  } catch (_) {
    return false;
  }
}

ipcMain.handle('get-lan-url', () => (lanAccessEnabled(loadConfig()) ? `http://${getLanIP()}:${appPort}` : null));
ipcMain.handle('get-data-dir', () => dataDir);
ipcMain.handle('get-port',     () => appPort);
ipcMain.handle('open-data-dir', () => shell.openPath(dataDir));

/**
 * Calls an internal server route with the per-launch secret and the app
 * window's session cookie, so the server can check that an admin is signed in.
 */
async function internalPost(route, body) {
  const url = `http://localhost:${appPort}`;
  let cookieHeader = '';
  try {
    const cookies = await (mainWindow ? mainWindow.webContents.session : require('electron').session.defaultSession).cookies.get({ url });
    cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (_) {}
  const res = await fetch(`${url}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-chuti-internal': INTERNAL_TOKEN, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `Chuti refused the request (${res.status}).`, code: data.code };
}

ipcMain.handle('choose-backup-folder', async (event) => {
  if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to save Chuti backup copies',
    message: 'Pick a second drive, a USB drive, or a Google Drive / OneDrive synced folder.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save backups here',
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const folder = result.filePaths[0];
  const outcome = await internalPost('/api/internal/backup-folder', { folder });
  if (outcome.ok) saveConfig({ ...(loadConfig() || {}), backupFolder: folder });
  log(`Backup folder ${outcome.ok ? 'set to' : 'rejected:'} ${folder}`);
  return outcome.ok ? { ok: true, folder } : outcome;
});

// ─── Backup encryption key store ──────────────────────────────────────────────
// The unlocked backup master key is kept outside the data folder (which may be
// copied, synced or backed up), encrypted with Windows DPAPI via safeStorage:
// readable only by this Windows user on this computer. It lets scheduled copies
// run after a restart without asking for the backup password.
const KEY_FILE = path.join(CONFIG_DIR, 'backup-key.dat');

function storeBackupKey(keyId, key) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      log('safeStorage unavailable: the backup password will be needed after each restart.');
      return false;
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, safeStorage.encryptString(JSON.stringify({ keyId, key })));
    return true;
  } catch (e) {
    log(`Could not store backup key: ${e.message}`);
    return false;
  }
}

function forgetBackupKey() {
  try { fs.rmSync(KEY_FILE, { force: true }); } catch (_) {}
}

async function loadBackupKeyIntoServer() {
  try {
    if (!fs.existsSync(KEY_FILE) || !safeStorage.isEncryptionAvailable()) return;
    const { keyId, key } = JSON.parse(safeStorage.decryptString(fs.readFileSync(KEY_FILE)));
    const result = await internalPost('/api/internal/backup-encryption', { action: 'load', keyId, key });
    if (!result.ok || result.ok === false) log('Stored backup key was not accepted (protection changed or data restored elsewhere).');
  } catch (e) {
    log(`Could not load stored backup key: ${e.message}`);
  }
}

async function encryptionAction(event, body, { keepKey = true } = {}) {
  if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
  const result = await internalPost('/api/internal/backup-encryption', body);
  if (!result.ok) return { ok: false, error: result.error };
  let remembered = false;
  if (keepKey && result.key && result.keyId) remembered = storeBackupKey(result.keyId, result.key);
  if (!keepKey) forgetBackupKey();
  log(`Backup encryption: ${body.action} succeeded`);
  // Never hand the raw key to the web page; it only needs the recovery code once.
  return { ok: true, recoveryCode: result.recoveryCode, remembered };
}

ipcMain.handle('backup-encryption-enable', (event, password) =>
  encryptionAction(event, { action: 'enable', password: String(password || '') }));
ipcMain.handle('backup-encryption-change', (event, current, password) =>
  encryptionAction(event, { action: 'change', current: String(current || ''), password: String(password || '') }));
ipcMain.handle('backup-encryption-unlock', (event, secret) =>
  encryptionAction(event, { action: 'unlock', secret: String(secret || '') }));
ipcMain.handle('backup-encryption-disable', (event) =>
  encryptionAction(event, { action: 'disable' }, { keepKey: false }));

ipcMain.handle('open-backup-folder', (event) => {
  if (!fromAppWindow(event)) return false;
  const folder = (loadConfig() || {}).backupFolder;
  if (folder && fs.existsSync(folder)) { shell.openPath(folder); return true; }
  return false;
});

// ─── Cloud backup (Google Drive / OneDrive) ───────────────────────────────────
// Sign-in happens in the system browser; tokens stay in this process and in a
// DPAPI-protected file next to config.json. The page only ever receives the
// provider name, the account email and results. See electron/cloud.
const { createCloudService } = require('./electron/cloud/service');
const { createTokenStore } = require('./electron/cloud/token-store');
const { resolveClients, validateUserClient } = require('./electron/cloud/client-config');

let cloud = null;
function cloudService() {
  if (!cloud) {
    cloud = createCloudService({
      internal: (action, body = {}) => internalPost('/api/internal/cloud-backup', { ...body, action }),
      openExternal: (url) => shell.openExternal(url),
      tokenStore: createTokenStore({
        file: path.join(CONFIG_DIR, 'cloud.dat'),
        crypto: {
          available: () => safeStorage.isEncryptionAvailable(),
          encrypt: (text) => safeStorage.encryptString(text),
          decrypt: (buf) => safeStorage.decryptString(buf),
        },
      }),
      clients: () => resolveClients({
        bundledFile: path.join(__dirname, 'cloud-config.json'),
        userClients: (loadConfig() || {}).cloudClients,
      }),
      log,
    });
  }
  return cloud;
}

/** Runs a cloud operation for the app window and turns failures into { ok: false, error }. */
async function cloudCall(event, fn) {
  if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
  try {
    const result = await fn(cloudService());
    return result && typeof result === 'object' && 'ok' in result ? result : { ok: true, ...(result && typeof result === 'object' ? result : {}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('cloud-status', (event) => cloudCall(event, (svc) => ({ ok: true, ...svc.status() })));
ipcMain.handle('cloud-connect', (event, provider) => cloudCall(event, (svc) => svc.connect(String(provider || ''))));
ipcMain.handle('cloud-disconnect', (event) => cloudCall(event, (svc) => svc.disconnect()));
ipcMain.handle('cloud-backup-now', (event) => cloudCall(event, (svc) => svc.backupNow('manual')));
ipcMain.handle('cloud-list', (event) => cloudCall(event, async (svc) => ({ ok: true, backups: await svc.list() })));
ipcMain.handle('cloud-restore', (event, id, name, secret, staged) =>
  cloudCall(event, (svc) => svc.restore(String(id || ''), String(name || ''), secret ? String(secret).slice(0, 200) : undefined, staged === true)));
ipcMain.handle('cloud-set-client', (event, provider, input) => cloudCall(event, () => {
  const id = String(provider || '');
  const cfg = loadConfig() || {};
  const clients = { ...(cfg.cloudClients || {}) };
  if (input === null) delete clients[id];
  else clients[id] = validateUserClient(id, input);
  saveConfig({ ...cfg, cloudClients: clients });
  log(`Cloud app registration ${input === null ? 'removed' : 'saved'} for ${id}`);
  return { ok: true };
}));

} // end of `else` block guarded by gotSingleInstanceLock — see top of file
