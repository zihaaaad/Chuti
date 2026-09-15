'use strict';

/**
 * Electron Preload Script
 * Exposes a safe, narrow IPC bridge from the renderer to the main process.
 * contextIsolation is ON — so we must use contextBridge, never nodeIntegration.
 * Browsers elsewhere on the LAN never get this bridge; the web UI checks for it.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chuti', {
  getLanUrl:          () => ipcRenderer.invoke('get-lan-url'),
  getDataDir:         () => ipcRenderer.invoke('get-data-dir'),
  getPort:            () => ipcRenderer.invoke('get-port'),
  openDataDir:        () => ipcRenderer.invoke('open-data-dir'),
  chooseBackupFolder: () => ipcRenderer.invoke('choose-backup-folder'),
  openBackupFolder:   () => ipcRenderer.invoke('open-backup-folder'),
  // Backup encryption. These never return the key itself to the page.
  enableBackupEncryption:  (password) => ipcRenderer.invoke('backup-encryption-enable', password),
  changeBackupPassword:    (current, password) => ipcRenderer.invoke('backup-encryption-change', current, password),
  unlockBackupEncryption:  (secret) => ipcRenderer.invoke('backup-encryption-unlock', secret),
  disableBackupEncryption: () => ipcRenderer.invoke('backup-encryption-disable'),
  // Cloud backup. Tokens never reach the page.
  cloudStatus:     () => ipcRenderer.invoke('cloud-status'),
  cloudConnect:    (provider) => ipcRenderer.invoke('cloud-connect', provider),
  cloudDisconnect: () => ipcRenderer.invoke('cloud-disconnect'),
  cloudBackupNow:  () => ipcRenderer.invoke('cloud-backup-now'),
  cloudList:       () => ipcRenderer.invoke('cloud-list'),
  cloudRestore:    (id, name, secret, staged) => ipcRenderer.invoke('cloud-restore', id, name, secret, staged),
  cloudSetClient:  (provider, input) => ipcRenderer.invoke('cloud-set-client', provider, input),
});
