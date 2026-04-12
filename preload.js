const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Clipboard
  getClipboardHistory: (opts) => ipcRenderer.invoke('get-clipboard-history', opts),
  copyToClipboard:     (opts) => ipcRenderer.invoke('copy-to-clipboard', opts),
  toggleFavorite:      (opts) => ipcRenderer.invoke('toggle-favorite', opts),
  deleteItem:          (opts) => ipcRenderer.invoke('delete-clipboard-item', opts),
  clearHistory:        ()     => ipcRenderer.invoke('clear-clipboard-history'),
  getStats:            ()     => ipcRenderer.invoke('get-stats'),

  // Emoji
  getEmojiFavorites:   ()     => ipcRenderer.invoke('get-emoji-favorites'),
  toggleEmojiFavorite: (opts) => ipcRenderer.invoke('toggle-emoji-favorite', opts),
  copyEmoji:           (opts) => ipcRenderer.invoke('copy-emoji', opts),

  // Window
  hideWindow:    () => ipcRenderer.invoke('hide-window'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Events: main → renderer
  onClipboardUpdated: (cb) => ipcRenderer.on('clipboard-updated',  () => cb()),
  onWindowHiding:     (cb) => ipcRenderer.on('window-hiding',      () => cb()),
  onWindowShowing:    (cb) => ipcRenderer.on('window-showing',     () => cb()),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',   (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded',  (_e, info) => cb(info)),
  onUpdateProgress:   (cb) => ipcRenderer.on('update-progress',    (_e, data) => cb(data)),
});
