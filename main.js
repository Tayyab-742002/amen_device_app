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

// Handle running the face verification script
ipcMain.handle('run-face-verification', async (event) => {
  try {
    // Get the path to the user data directory where Reference_images are stored
    const referenceImagesPath = path.join(app.getPath('userData'), 'Reference_images');
    
    // Check if Python is installed and accessible
    const { spawn } = require('child_process');
    
    // Create a temporary directory for captured faces
    const capturedFacesPath = path.join(app.getPath('temp'), 'Captured_Faces');
    if (!fs.existsSync(capturedFacesPath)) {
      fs.mkdirSync(capturedFacesPath, { recursive: true });
    }
    
    // Create a communication file for the verification result
    const resultFilePath = path.join(app.getPath('temp'), 'verification_result.json');
    
    // Path to the Python script
    const scriptPath = path.join(__dirname, 'auto_face_recognition.py');
    
    // Copy the Python script to a temporary location if it doesn't exist
    if (!fs.existsSync(scriptPath)) {
      fs.copyFileSync(path.join(__dirname, 'auto_face_recognition.py'), scriptPath);
    }
    
    // Run the Python script with arguments
    console.log('Starting face verification script...');
    
    // Create a promise that will resolve when the verification is complete
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python', [
        scriptPath,
        '--reference-dir', referenceImagesPath,
        '--captured-dir', capturedFacesPath,
        '--result-file', resultFilePath,
        '--auto-close'
      ]);
      
      let resultData = '';
      let errorData = '';
      
      pythonProcess.stdout.on('data', (data) => {
        console.log(`Python stdout: ${data}`);
        resultData += data.toString();
        
        // Check if verification is complete
        if (data.toString().includes('VERIFICATION_COMPLETE:')) {
          try {
            // Extract only the JSON part from the output
            const dataStr = data.toString();
            const startIndex = dataStr.indexOf('VERIFICATION_COMPLETE:') + 'VERIFICATION_COMPLETE:'.length;
            let jsonStr = dataStr.substring(startIndex).trim();
            
            // If there are multiple lines, take only the first line (the JSON)
            if (jsonStr.includes('\n')) {
              jsonStr = jsonStr.split('\n')[0].trim();
            }
            
            console.log('Extracted JSON:', jsonStr);
            const result = JSON.parse(jsonStr);
            resolve(result);
          } catch (e) {
            console.error('Error parsing verification result:', e);
            console.error('Raw data:', data.toString());
          }
        }
      });
      
      pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data}`);
        errorData += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        
        // If we haven't resolved yet, check for a result file
        try {
          if (fs.existsSync(resultFilePath)) {
            const resultJson = fs.readFileSync(resultFilePath, 'utf8');
            const result = JSON.parse(resultJson);
            resolve(result);
          } else if (code !== 0) {
            reject(new Error(`Python process exited with code ${code}: ${errorData}`));
          } else {
            reject(new Error('No verification result found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  } catch (error) {
    console.error('Error running face verification:', error);
    return { success: false, error: error.message };
  }
}); 