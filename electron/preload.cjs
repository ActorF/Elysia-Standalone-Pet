// Small, typed-by-shape bridge; renderer never receives Node or unrestricted IPC.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('elysiaDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('pet:get-state'),
  onPointer: (callback) => subscribe('pet:pointer', callback),
  onAction: (callback) => subscribe('pet:action', callback),
  onSettings: (callback) => subscribe('pet:settings', callback),
  setSettings: (patch) => ipcRenderer.invoke('pet:set-settings', patch),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (delta) => ipcRenderer.send('pet:drag-move', delta),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  showMenu: () => ipcRenderer.send('pet:menu'),
  quit: () => ipcRenderer.send('pet:quit'),
}));
