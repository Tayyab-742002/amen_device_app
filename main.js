require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
// Load environment variables from .env file

// Log environment variables to console
console.log('SUPABASE_URL from env:', process.env.SUPABASE_URL ? 'Value exists' : 'Value is missing');
console.log('SUPABASE_ANON_KEY from env:', process.env.SUPABASE_ANON_KEY ? 'Value exists' : 'Value is missing');

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
  
  // Navigate to main screen directly without reloading
  if (mainWindow) {
    mainWindow.loadFile('src/index.html');
  }
  
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

// Handle app restart request
ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
  return { success: true };
});

// Handle environment variables request
ipcMain.handle('get-env-vars', () => {
  console.log('get-env-vars called, returning:', {
    SUPABASE_URL: process.env.SUPABASE_URL ? 'Value exists' : 'Value is missing',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'Value exists' : 'Value is missing'
  });
  
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };
}); 