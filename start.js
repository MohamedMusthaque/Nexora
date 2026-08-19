require('dotenv').config();
const log = require('electron-log');
const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const path = require('path')
const fs = require('fs')
const { getDataRoot, setDataRoot, getPosDir } = require('./lib/dataConfig')

// Single-instance guard: a second launch (double-click, installer, update)
// would crash the express server with EADDRINUSE on port 8001. Quit instead
// and focus the already-running window.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// nedb 1.8.0 uses legacy util.is* APIs that were removed in Node 22
// (bundled with Electron 43). Restore the ones nedb relies on before it loads.
const util = require('util');
if (!util.isDate) util.isDate = (v) => v instanceof Date;
if (!util.isArray) util.isArray = Array.isArray;
if (!util.isRegExp) util.isRegExp = (v) => v instanceof RegExp;

// Set the log file location
log.transports.file.file = `${app.getPath('userData')}/nexora.log`;

// Set the log level (optional)
log.transports.file.level = 'info'; // or 'debug', 'warn', 'error', etc.

// Configure other options (optional)
log.transports.file.format = '{h}:{i}:{s} {level} {text}';

// Add logging to console (optional)
log.transports.console.level = false; // Disable console logging

// Initialize the logger
log.catchErrors();

// Usage example
log.info('App started');

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1200,
    frame: false,
    minWidth: 1200, 
    minHeight: 750,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    },
  });

  mainWindow.maximize();
  mainWindow.show();

  mainWindow.loadURL(
    `file://${path.join(__dirname, 'index.html')}`
  )

  // jsPDF's pdf.save() (used by the Products "Download" button) triggers a
  // browser-style download, which Electron saves silently to the default
  // downloads folder unless we opt into a native Save As dialog here.
  mainWindow.webContents.session.on('will-download', (event, item) => {
    item.setSaveDialogOptions({
      title: 'Save File',
      defaultPath: item.getFilename(),
    });
  });

  // Forward renderer console messages (incl. JS errors) to the main-process log
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const label = ['verbose', 'info', 'warning', 'error'][level] || level;
    log.info(`[renderer:${label}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}


app.on("ready", async ()=>{
  const setupEvents = require('./installers/setupEvents')
  if (setupEvents.handleSquirrelEvent()) {
    return;
  }
  process.env.APPDATA = getDataRoot();
  // multer's diskStorage (uploads) doesn't create its destination folder on
  // its own, unlike nedb (which mkdirp's server/databases internally) - so a
  // freshly chosen/empty data directory needs this or the first logo/product
  // image upload fails with ENOENT.
  fs.mkdirSync(path.join(getPosDir(), 'uploads'), { recursive: true });
  require('./server');

  // electron-store v8 renderer persistence bridge: must be called from the
  // main process, otherwise storage.set()/get() silently no-op in the renderer
  // (and login can never persist).
  try {
    const ElectronStore = require('electron-store');
    (ElectronStore.default || ElectronStore).initRenderer();
  } catch (e) {
    log.warn('electron-store initRenderer failed:', e.message);
  }

  createWindow();

  // electron-context-menu v4 is ESM-only, so it must be loaded via dynamic import()
  const { default: contextMenu } = await import('electron-context-menu');
  contextMenu({
    prepend: (params, browserWindow) => [
      {
        label: 'DevTools',
        click(item, focusedWindow) {
          focusedWindow.toggleDevTools();
        },
      },
      {
        label: 'Reload',
        click() {
          mainWindow.reload();
        },
      },
    ],
  });
  
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    const appVersion = app.getVersion();
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'MohamedMusthaque',
      repo: 'NexoraPOS',
      token: process.env.GITHUB_TOKEN,
      url: `https://github.com/MohamedMusthaque/NexoraPOS/releases/tag/v${appVersion}`,
    });
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    log.warn('Auto-updater disabled:', e.message);
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})



ipcMain.on('app-quit', (evt, arg) => {
  app.quit()
})


ipcMain.on('app-reload', (event, arg) => {
  mainWindow.reload();
});

ipcMain.on('app-relaunch', () => {
  app.relaunch();
  app.exit(0);
});

// --- Data location / backup / restore -------------------------------------
// nedb datastores are opened once, synchronously, at `require('./api/*')`
// time (see server.js), so none of these operations can just flip
// process.env.APPDATA and reload the window - the whole process has to
// relaunch for a new/restored data directory to actually take effect.

ipcMain.handle('data:get-location', () => {
  return { dataRoot: getDataRoot(), posDir: getPosDir() };
});

ipcMain.handle('data:choose-folder', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Select Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('data:set-location', async (event, newRoot) => {
  try {
    const currentRoot = getDataRoot();
    if (path.resolve(currentRoot) === path.resolve(newRoot)) {
      return { success: true, moved: false };
    }

    const currentPosDir = getPosDir(currentRoot);
    const newPosDir = getPosDir(newRoot);

    if (fs.existsSync(newPosDir)) {
      return { success: false, error: 'The selected folder already contains a "POS" data folder. Choose an empty folder, or restore from it instead of setting it as a new location.' };
    }

    fs.mkdirSync(newRoot, { recursive: true });
    if (fs.existsSync(currentPosDir)) {
      fs.cpSync(currentPosDir, newPosDir, { recursive: true });
    }

    setDataRoot(newRoot);
    return { success: true, moved: true };
  } catch (e) {
    log.error('Failed to change data location:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('data:backup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Backup Destination Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destDir = path.join(result.filePaths[0], `Nexora-Backup-${timestamp}`);

    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(getPosDir(), path.join(destDir, 'POS'), { recursive: true });

    return { success: true, path: destDir };
  } catch (e) {
    log.error('Backup failed:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('data:restore', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Backup Folder to Restore',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  try {
    const selected = result.filePaths[0];
    // Accept either a backup root (containing a "POS" subfolder, as created
    // by data:backup above) or the POS folder itself.
    const sourcePosDir = fs.existsSync(path.join(selected, 'POS'))
      ? path.join(selected, 'POS')
      : selected;

    if (!fs.existsSync(path.join(sourcePosDir, 'server', 'databases'))) {
      return { success: false, error: 'The selected folder does not look like a valid Nexora backup.' };
    }

    const posDir = getPosDir();
    fs.rmSync(posDir, { recursive: true, force: true });
    fs.cpSync(sourcePosDir, posDir, { recursive: true });

    return { success: true };
  } catch (e) {
    log.error('Restore failed:', e);
    return { success: false, error: e.message };
  }
});
