'use strict';

/**
 * Electron Preload Script
 * Exposes a safe, narrow IPC bridge from the renderer to the main process.
 * contextIsolation is ON — so we must use contextBridge, never nodeIntegration.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chuti', {
  getLanUrl:    () => ipcRenderer.invoke('get-lan-url'),
  getDataDir:   () => ipcRenderer.invoke('get-data-dir'),
  getPort:      () => ipcRenderer.invoke('get-port'),
  openDataDir:  () => ipcRenderer.invoke('open-data-dir'),
});
