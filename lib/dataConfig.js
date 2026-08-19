const { app } = require('electron');
const path = require('path');

// Separate from the renderer's `storage` (electron-store "config.json"), so
// that changing the data location can never itself become unreadable: this
// store always lives in the fixed OS userData folder, never in the
// user-selected data root it's pointing at.
//
// Lazily constructed (not at module load) because electron-store reads
// app.getPath('userData') at construction time, which isn't reliably
// available until the app "ready" event has fired.
let configStore = null;
function getConfigStore() {
  if (!configStore) {
    const Store = require('electron-store');
    const StoreClass = Store.default || Store;
    configStore = new StoreClass({ name: 'app-config' });
  }
  return configStore;
}

function defaultDataRoot() {
  return path.join(app.getPath('home'), app.name);
}

function getDataRoot() {
  return getConfigStore().get('dataRoot') || defaultDataRoot();
}

function setDataRoot(newRoot) {
  getConfigStore().set('dataRoot', newRoot);
}

// All nedb/.db files and uploads live under "<dataRoot>/POS", matching the
// legacy hardcoded suffix used throughout api/*.js.
function getPosDir(root) {
  return path.join(root || getDataRoot(), 'POS');
}

module.exports = { getDataRoot, setDataRoot, defaultDataRoot, getPosDir };
