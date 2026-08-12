require('dotenv').config();
const log = require('electron-log');
const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path')

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

const contextMenu = require('electron-context-menu');

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

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}


app.on("ready", ()=>{
  const setupEvents = require('./installers/setupEvents')
  if (setupEvents.handleSquirrelEvent()) {
    return;
  }
  process.env.APPDATA = path.join(app.getPath('home'),app.name);
  require('./server');
  createWindow();
  
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



contextMenu({
  prepend: (params, browserWindow) => [
     
      {label: 'DevTools',
       click(item, focusedWindow){
        focusedWindow.toggleDevTools();
      }
    },
     { 
      label: "Reload", 
        click() {
          mainWindow.reload();
      } 
    // },
    // {  label: 'Quit',  click:  function(){
    //    mainWindow.destroy();
    //     mainWindow.quit();
    // } 
  }  
  ],

});

 

 