require('dotenv').config();
const log = require('electron-log');
const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path')

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
log.transports.file.file = `${app.getPath('userData')}/quicktill.log`;

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
  process.env.APPDATA = path.join(app.getPath('home'),app.name);
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
      owner: 'Ayuen-madyt',
      repo: 'Quicktill',
      token: process.env.GITHUB_TOKEN,
      url: `https://github.com/Ayuen-madyt/Quicktill/releases/tag/v${appVersion}`,
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
