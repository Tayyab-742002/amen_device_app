require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
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

// Helper function to download an image using https
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    // Parse URL to handle redirects properly
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
      }
    };
    
    https.get(options, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`Redirecting to: ${redirectUrl}`);
        return resolve(downloadImage(redirectUrl));
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', (err) => reject(err));
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Handle downloading images to a specific folder
ipcMain.handle('download-images', async (event, imageData) => {
  try {
    // Create Reference_images directory in the app's user data directory
    const downloadsPath = path.join(app.getPath('userData'), 'Reference_images');
    
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }
    
    // Download the image
    const buffer = await downloadImage(imageData.url);
    
    // Create filename with username
    const filename = path.join(downloadsPath, `${imageData.username}${imageData.extension}`);
    
    // Write file to disk
    fs.writeFileSync(filename, buffer);
    
    return { 
      success: true, 
      path: filename,
      folderPath: downloadsPath
    };
  } catch (error) {
    console.error('Error downloading image:', error);
    return { success: false, error: error.message };
  }
}); 