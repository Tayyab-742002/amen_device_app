const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI', {
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    getConfig: () => ipcRenderer.invoke('get-config'),
    resetConfig: () => ipcRenderer.invoke('reset-config'),
    restartApp: () => ipcRenderer.invoke('restart-app'),
    getEnvVars: () => ipcRenderer.invoke('get-env-vars'),
    downloadImage: (imageData) => ipcRenderer.invoke('download-images', imageData),
    runFaceVerification: () => ipcRenderer.invoke('run-face-verification'),
    startRoute: (vehicleId) => ipcRenderer.invoke('start-route', vehicleId),
    stopRoute: (vehicleId) => ipcRenderer.invoke('stop-route', vehicleId),
    sendEmergencyAlert: (vehicleId, organizationId, emergencyType) => ipcRenderer.invoke('send-emergency-alert', vehicleId, organizationId, emergencyType)
  }
); 