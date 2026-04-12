const {
  app, BrowserWindow, globalShortcut, clipboard,
  ipcMain, Tray, Menu, nativeImage, screen
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Performance flags ─────────────────────────────────────────────────────────
// Must be set before app is ready
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=96');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('disable-default-apps');

// Disable GPU compositing — fixes transparent window crashes on many systems
app.disableHardwareAcceleration();

const logger = require('./logger');
const { initUpdater } = require('./updater');

let mainWindow        = null;
let tray              = null;
let clipboardPoller   = null;
let lastClipboardText = '';
let isWindowVisible   = false;
let isAnimating       = false; // guard against blur firing during show/hide

// ── Storage ───────────────────────────────────────────────────────────────────

let dataDir     = '';
let historyPath = '';
let emojiPath   = '';
let historyData = { items: [] };
let emojiData   = { favorites: [] };
let nextId      = 1;
let saveTimer   = null;

function initStorage() {
  dataDir     = app.getPath('userData');
  historyPath = path.join(dataDir, 'history.json');
  emojiPath   = path.join(dataDir, 'emoji-favorites.json');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(historyPath)) {
    try { historyData = JSON.parse(fs.readFileSync(historyPath, 'utf8')); }
    catch(e) { logger.warn('history.json parse error:', e.message); historyData = { items: [] }; }
  }
  if (fs.existsSync(emojiPath)) {
    try { emojiData = JSON.parse(fs.readFileSync(emojiPath, 'utf8')); }
    catch(e) { logger.warn('emoji-favorites.json parse error:', e.message); emojiData = { favorites: [] }; }
  }

  if (!Array.isArray(historyData.items))   historyData.items   = [];
  if (!Array.isArray(emojiData.favorites)) emojiData.favorites = [];

  nextId = historyData.items.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;
  logger.info('Storage ready. Items:', historyData.items.length);
}

function saveHistory() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(historyPath, JSON.stringify(historyData), 'utf8'); }
    catch(e) { logger.error('saveHistory failed:', e); }
  }, 400);
}

function saveEmojis() {
  try { fs.writeFileSync(emojiPath, JSON.stringify(emojiData), 'utf8'); }
  catch(e) { logger.error('saveEmojis failed:', e); }
}

// ── Register startup ──────────────────────────────────────────────────────────

function registerStartup() {
  try {
    const appDir      = path.resolve(__dirname);
    const electronCmd = path.join(appDir, 'node_modules', '.bin', 'electron.cmd');

    const startupFolder = path.join(
      process.env.APPDATA,
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
    );
    const batPath = path.join(startupFolder, 'ClipboardManager.bat');

    const bat = [
      '@echo off',
      `cd /d "${appDir}"`,
      `start "" /B "${electronCmd}" . --hidden`,
      ''
    ].join('\r\n');

    fs.writeFileSync(batPath, bat, 'utf8');
    logger.info('Startup registered:', batPath);
  } catch(e) {
    logger.warn('Could not register startup:', e.message);
  }
}

// ── Clipboard monitoring ──────────────────────────────────────────────────────
// Adaptive polling: fast (500ms) when window is visible, slow (2s) when hidden

const POLL_FAST = 500;
const POLL_SLOW = 2000;

function startClipboardMonitor() {
  lastClipboardText = clipboard.readText();
  scheduleNextPoll();
}

function scheduleNextPoll() {
  if (clipboardPoller) return; // already scheduled
  const delay = isWindowVisible ? POLL_FAST : POLL_SLOW;
  clipboardPoller = setTimeout(pollClipboard, delay);
}

function pollClipboard() {
  clipboardPoller = null;
  try {
    const text = clipboard.readText();
    if (text && text !== lastClipboardText && text.trim().length > 0) {
      lastClipboardText = text;
      addClipboardItem(text, 'text');
    }
  } catch(e) {
    logger.warn('clipboard read error:', e.message);
  }
  scheduleNextPoll();
}

function addClipboardItem(content, type) {
  const items = historyData.items;
  if (items.length > 0 && items[0].content === content) return;

  items.unshift({ id: nextId++, content, type, timestamp: Date.now(), favorite: false });

  if (items.length > 50000) {
    historyData.items = items.filter((it, idx) => idx < 10000 || it.favorite);
  }

  saveHistory();

  if (mainWindow && !mainWindow.isDestroyed() && isWindowVisible) {
    mainWindow.webContents.send('clipboard-updated');
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

function queryHistory({ search, favoritesOnly, limit = 200, offset = 0 } = {}) {
  let results = historyData.items;
  if (favoritesOnly) results = results.filter(i => i.favorite);
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    results = results.filter(i => i.content.toLowerCase().includes(q));
  }
  results = [...results].sort((a, b) => {
    if (a.favorite !== b.favorite) return b.favorite ? 1 : -1;
    return b.timestamp - a.timestamp;
  });
  return results.slice(offset, offset + limit);
}

// ── Tray icon ─────────────────────────────────────────────────────────────────

function makeTrayIcon() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAiElEQVQ4jd2SMQqAMAxFX8VFL+LFvIiHcHEv4eZiD+IhXNyLiAP+GNoSqAoFHwTy8pKXkCiSJEmSJEn6VwCIiCbpSboBrOoiZj4z86qqewBgZhcAmNktIs4A3IhobWaXmR0i4gmgBrACzgBeRaQCOI+ZOcANwBuAUyGkpJQaQxpDSuklAAAASUVORK5CYII=';
  return nativeImage.createFromDataURL('data:image/png;base64,' + b64);
}

// ── Window management ─────────────────────────────────────────────────────────

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:           460,
    height:          600,
    x:               Math.round(width  / 2 - 230),
    y:               Math.round(height / 2 - 300),
    frame:           false,
    transparent:     true,
    backgroundColor: '#00000000',
    resizable:       false,
    skipTaskbar:     true,
    alwaysOnTop:     true,
    show:            false,
    hasShadow:       true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      // Performance: disable unused renderer features
      spellcheck:       false,
      enableWebSQL:     false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('Renderer crashed — reason:', details.reason, '| exit code:', details.exitCode);
    mainWindow = null;
    isWindowVisible = false;
    isAnimating = false;
    // Recreate window so hotkey still works after crash
    setTimeout(createWindow, 500);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    logger.error('Renderer failed to load:', code, desc);
  });

  mainWindow.on('blur', () => {
    if (isWindowVisible && !isAnimating) hideWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isWindowVisible = false;
  });

  // Wire updater once window is created
  initUpdater(() => mainWindow);
}

function showWindow() {
  if (isAnimating) return;

  // Lazy creation — if window was never built (--hidden startup) build now
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(
    Math.round(width  / 2 - 230),
    Math.round(height / 2 - 300)
  );

  isAnimating     = true;
  isWindowVisible = true;

  // Switch to fast polling while visible
  if (clipboardPoller) { clearTimeout(clipboardPoller); clipboardPoller = null; }
  scheduleNextPoll();

  const doShow = () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window-showing');
    setTimeout(() => { isAnimating = false; }, 350);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', doShow);
  } else {
    doShow();
  }
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isAnimating) return;

  isAnimating     = true;
  isWindowVisible = false;

  // Switch back to slow polling when hidden
  if (clipboardPoller) { clearTimeout(clipboardPoller); clipboardPoller = null; }
  scheduleNextPoll();

  mainWindow.webContents.send('window-hiding');
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    isAnimating = false;
  }, 200);
}

function toggleWindow() {
  if (isAnimating) return;
  if (isWindowVisible) hideWindow(); else showWindow();
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  try {
    tray = new Tray(makeTrayIcon());
  } catch(e) {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip('Clipboard Manager');
  tray.on('click', toggleWindow);
  updateTrayMenu('Alt+V');
}

function updateTrayMenu(hotkey) {
  tray.setToolTip(`Clipboard Manager — ${hotkey}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open  (${hotkey})`, click: showWindow },
    { type:  'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-clipboard-history', (_e, opts) => queryHistory(opts || {}));

  ipcMain.handle('copy-to-clipboard', (_e, { content }) => {
    clipboard.writeText(content);
    lastClipboardText = content;
    return true;
  });

  ipcMain.handle('toggle-favorite', (_e, { id, value }) => {
    const item = historyData.items.find(i => i.id === id);
    if (item) { item.favorite = !!value; saveHistory(); }
    return true;
  });

  ipcMain.handle('delete-clipboard-item', (_e, { id }) => {
    historyData.items = historyData.items.filter(i => i.id !== id);
    saveHistory();
    return true;
  });

  ipcMain.handle('clear-clipboard-history', () => {
    historyData.items = historyData.items.filter(i => i.favorite);
    saveHistory();
    return true;
  });

  ipcMain.handle('get-emoji-favorites', () => emojiData.favorites);

  ipcMain.handle('toggle-emoji-favorite', (_e, { emoji, isFav }) => {
    if (isFav) {
      if (!emojiData.favorites.includes(emoji)) emojiData.favorites.unshift(emoji);
    } else {
      emojiData.favorites = emojiData.favorites.filter(e => e !== emoji);
    }
    saveEmojis();
    return true;
  });

  ipcMain.handle('copy-emoji', (_e, { emoji }) => {
    clipboard.writeText(emoji);
    lastClipboardText = emoji;
    hideWindow();
    return true;
  });

  ipcMain.handle('hide-window', () => hideWindow());

  ipcMain.handle('get-stats', () => ({
    count:    historyData.items.length,
    favCount: historyData.items.filter(i => i.favorite).length
  }));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  logger.info('App starting. Version:', app.getVersion(), '| Packaged:', app.isPackaged);
  initStorage();
  setupIPC();
  createTray();
  startClipboardMonitor();
  registerStartup();

  const candidates = ['Alt+V', 'CommandOrControl+Shift+V', 'CommandOrControl+Shift+C', 'Alt+Shift+V'];
  for (const hk of candidates) {
    if (globalShortcut.register(hk, toggleWindow)) {
      logger.info('Hotkey registered:', hk);
      updateTrayMenu(hk);
      break;
    }
  }

  // If not launched hidden, create window immediately and show it
  // If launched hidden (startup), defer window creation until first toggle
  const launchHidden = process.argv.includes('--hidden');
  if (!launchHidden) {
    createWindow();
    showWindow();
  }
  // Window is created lazily on first toggleWindow() call when launchHidden
});

app.on('will-quit', () => {
  logger.info('App quitting');
  globalShortcut.unregisterAll();
  if (clipboardPoller) clearTimeout(clipboardPoller);
});

app.on('window-all-closed', e => e.preventDefault());
