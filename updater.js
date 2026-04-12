const { ipcMain, app } = require('electron');
const logger = require('./logger');

let _mainWindow  = null;
let _initialized = false;

function initUpdater(getWindow) {
  if (_initialized) return;
  _initialized = true;

  // Auto-updater only makes sense in packaged builds
  if (!app.isPackaged) {
    logger.info('[Updater] Dev mode — update checks disabled');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    logger.warn('[Updater] electron-updater not available:', e.message);
    return;
  }

  autoUpdater.logger         = logger;
  autoUpdater.autoDownload   = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logger.info('[Updater] Checking for update…');
  });

  autoUpdater.on('update-available', (info) => {
    logger.info('[Updater] Update available:', info.version);
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available', { version: info.version });
    }
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('[Updater] Up to date.');
  });

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent);
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-progress', { percent: pct });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('[Updater] Update downloaded:', info.version);
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-downloaded', { version: info.version });
    }
  });

  autoUpdater.on('error', (err) => {
    logger.error('[Updater] Error:', err.message);
  });

  // First check 5 minutes after launch, then every 4 hours
  setTimeout(() => { try { autoUpdater.checkForUpdates(); } catch(e) { logger.error('[Updater]', e); } },
    5 * 60 * 1000);
  setInterval(() => { try { autoUpdater.checkForUpdates(); } catch(e) { logger.error('[Updater]', e); } },
    4 * 60 * 60 * 1000);

  // IPC: renderer can request install
  ipcMain.handle('install-update', () => {
    try { autoUpdater.quitAndInstall(false, true); } catch(e) { logger.error('[Updater] install failed:', e); }
  });
}

module.exports = { initUpdater };
