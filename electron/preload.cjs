// Small, typed-by-shape bridge; renderer never receives Node or unrestricted IPC.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { callback(payload); }
    finally {
      if (channel === 'pet:pointer' && Number.isSafeInteger(payload?.sequence)) ipcRenderer.send('pet:pointer-received', payload.sequence);
      if (channel === 'pet:viewport' && Number.isSafeInteger(payload?.sequence)) ipcRenderer.send('pet:viewport-received', payload.sequence);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('elysiaDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('pet:get-state'),
  onPointer: (callback) => subscribe('pet:pointer', callback),
  onDragState: (callback) => subscribe('pet:drag-state', callback),
  onAction: (callback) => subscribe('pet:action', callback),
  onSettings: (callback) => subscribe('pet:settings', callback),
  onViewport: (callback) => subscribe('pet:viewport', callback),
  setSettings: (patch) => ipcRenderer.invoke('pet:set-settings', patch),
  zoomBy: (input) => ipcRenderer.invoke('pet:zoom-by', input),
  setAppearance: (appearance) => ipcRenderer.send('pet:set-appearance', appearance),
  setHitRegion: (region) => ipcRenderer.invoke('pet:set-hit-region', region),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  quit: () => ipcRenderer.send('pet:quit'),
}));
