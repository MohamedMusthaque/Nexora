const { app } = require('electron');
const path = require('path');
const Store = require('electron-store');
const store = new Store({ name: 'app-config' });
console.log('dataRoot:', store.get('dataRoot'));
console.log('default:', path.join(app.getPath('home'), app.name));
app.quit();
