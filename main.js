const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Initialize persistent storage
const store = new Store();

let mainWindow;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Check if organization ID and vehicle ID are stored
  const orgId = store.get('organizationId');
  const vehicleId = store.get('vehicleId');

  // Load the appropriate HTML file
  if (orgId && vehicleId) {
    mainWindow.loadFile('src/index.html');
  } else {
    mainWindow.loadFile('src/setup.html');
  }

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
ipcMain.handle('save-config', (event, { organizationId, vehicleId }) => {
  store.set('organizationId', organizationId);
  store.set('vehicleId', vehicleId);
  return { success: true };
});

ipcMain.handle('get-config', () => {
  return {
    organizationId: store.get('organizationId'),
    vehicleId: store.get('vehicleId')
  };
});

ipcMain.handle('reset-config', () => {
  store.delete('organizationId');
  store.delete('vehicleId');
  return { success: true };
}); 