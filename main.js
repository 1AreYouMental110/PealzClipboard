const {
  app, BrowserWindow, globalShortcut, clipboard,
  ipcMain, Tray, Menu, nativeImage, screen
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');

// ── Performance flags (must be before app ready) ──────────────────────────────
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=96');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('disable-default-apps');
app.disableHardwareAcceleration();

const logger = require('./logger');
const { initUpdater } = require('./updater');

// ── Global crash guards ───────────────────────────────────────────────────────
// Catch anything that slips through — prevents silent process death.
process.on('uncaughtException',  (err) => logger.error('[uncaughtException]',  err.stack || err));
process.on('unhandledRejection', (err) => logger.error('[unhandledRejection]', err));

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow        = null;
let tray              = null;
let clipboardPoller   = null;
let lastClipboardText = '';
let isWindowVisible   = false;
let isAnimating       = false;

// ── Storage ───────────────────────────────────────────────────────────────────
let dataDir     = '';
let historyPath = '';
let emojiPath   = '';
let historyData = { items: [] };
let emojiData   = { favorites: [] };
let nextId      = 1;
let saveTimer   = null;

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed || fallback;
  } catch(e) {
    logger.warn(`[storage] failed to parse ${path.basename(filePath)}:`, e.message);
    // Try .tmp backup (written atomically — may be a newer complete copy)
    const tmp = filePath + '.tmp';
    if (fs.existsSync(tmp)) {
      try { return JSON.parse(fs.readFileSync(tmp, 'utf8')) || fallback; } catch {}
    }
    return fallback;
  }
}

function writeJson(filePath, data) {
  // Atomic write: write to .tmp then rename so a crash mid-write never corrupts
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, filePath);
}

function initStorage() {
  dataDir     = app.getPath('userData');
  historyPath = path.join(dataDir, 'history.json');
  emojiPath   = path.join(dataDir, 'emoji-favorites.json');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  historyData = loadJson(historyPath, { items: [] });
  emojiData   = loadJson(emojiPath,   { favorites: [] });

  if (!Array.isArray(historyData.items))   historyData.items   = [];
  if (!Array.isArray(emojiData.favorites)) emojiData.favorites = [];

  // Sanitise: remove any items with missing/corrupt fields
  historyData.items = historyData.items.filter(
    i => i && typeof i.id === 'number' && typeof i.content === 'string'
  );

  nextId = historyData.items.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;
  logger.info('[storage] ready — items:', historyData.items.length);
}

function saveHistory() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeJson(historyPath, historyData); }
    catch(e) { logger.error('[storage] saveHistory failed:', e.message); }
  }, 400);
}

function saveEmojis() {
  try { writeJson(emojiPath, emojiData); }
  catch(e) { logger.error('[storage] saveEmojis failed:', e.message); }
}

function flushSync() {
  // Called from will-quit — synchronously flush any pending saves.
  clearTimeout(saveTimer);
  try { writeJson(historyPath, historyData); } catch {}
  try { writeJson(emojiPath,   emojiData);   } catch {}
}

// ── Startup registration ──────────────────────────────────────────────────────
function registerStartup() {
  try {
    const appDir      = path.resolve(__dirname);
    const electronCmd = path.join(appDir, 'node_modules', '.bin', 'electron.cmd');
    const batPath = path.join(
      process.env.APPDATA,
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
      'ClipboardManager.bat'
    );
    const bat = ['@echo off', `cd /d "${appDir}"`, `start "" /B "${electronCmd}" . --hidden`, ''].join('\r\n');
    fs.writeFileSync(batPath, bat, 'utf8');
    logger.info('[startup] registered:', batPath);
  } catch(e) {
    logger.warn('[startup] could not register:', e.message);
  }
}

// ── Clipboard monitor ─────────────────────────────────────────────────────────
// Poll every 500ms always. Clipboard reads are extremely cheap (single Win32
// call) so there is no meaningful CPU cost. 2s was too slow — users copying
// multiple things quickly or opening the window right after a copy would miss
// items entirely.
const POLL_INTERVAL = 500;

function startClipboardMonitor() {
  try { lastClipboardText = clipboard.readText(); } catch {}
  scheduleNextPoll();
}

function scheduleNextPoll() {
  if (clipboardPoller) return;
  clipboardPoller = setTimeout(pollClipboard, POLL_INTERVAL);
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
    logger.warn('[clipboard] read error:', e.message);
  }
  scheduleNextPoll();
}

// Immediate one-off poll — called when window opens so the list is always
// current even if the regular timer hasn't fired yet.
function pollNow() {
  if (clipboardPoller) { clearTimeout(clipboardPoller); clipboardPoller = null; }
  pollClipboard();
}

function addClipboardItem(content, type) {
  const items = historyData.items;
  if (items.length > 0 && items[0].content === content) return;

  items.unshift({ id: nextId++, content, type, timestamp: Date.now(), favorite: false });

  // Keep at most 50k items; trim to 10k (preserving favorites) when over limit
  if (items.length > 50000) {
    historyData.items = items.filter((it, idx) => idx < 10000 || it.favorite);
  }

  saveHistory();

  if (mainWindow && !mainWindow.isDestroyed() && isWindowVisible) {
    try { mainWindow.webContents.send('clipboard-updated'); } catch {}
  }
}

function queryHistory({ search, favoritesOnly, limit = 500, offset = 0 } = {}) {
  try {
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
  } catch(e) {
    logger.error('[query] queryHistory error:', e.message);
    return [];
  }
}

// ── Text-field detection ──────────────────────────────────────────────────────
// Fired at window-open time while the previous app still holds focus.
// Resolves to true = user was in a text input → auto-paste after copy.

let textFieldCheckPromise = Promise.resolve(false);
let checkFocusScript      = null;

function ensureCheckScript() {
  if (checkFocusScript) return checkFocusScript;
  checkFocusScript = path.join(dataDir || app.getPath('userData'), 'checkfocus.ps1');
  // Detect text inputs via multiple UIAutomation strategies:
  // 1. ControlType.Edit (50004) / Document (50030) — standard controls
  // 2. TextPattern — covers Chrome/Electron contenteditable (Discord, VS Code…)
  // 3. ValuePattern (not read-only) — simpler custom inputs
  const ps = [
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    'try {',
    '  $el = [System.Windows.Automation.AutomationElement]::FocusedElement',
    '  if ($null -eq $el) { Write-Output 0; exit }',
    '  $ct = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty)',
    '  if ($ct.Id -eq 50004 -or $ct.Id -eq 50030) { Write-Output 1; exit }',
    '  $pats = $el.GetSupportedPatterns()',
    '  if ($pats -contains [System.Windows.Automation.TextPattern]::Pattern) { Write-Output 1; exit }',
    '  if ($pats -contains [System.Windows.Automation.ValuePattern]::Pattern) {',
    '    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
    '    if (-not $vp.Current.IsReadOnly) { Write-Output 1; exit }',
    '  }',
    // Fallback: Chrome/Electron apps (Discord, VS Code, Slack, etc.) use web-based
    // inputs that UIAutomation often can't see via element type alone.
    // If the focused process is a known browser/editor/chat app, assume text input.
    '  $procId = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ProcessIdProperty)',
    '  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue',
    '  if ($proc) {',
    '    $n = $proc.ProcessName.ToLower()',
    '    $webApps = @("discord","chrome","msedge","firefox","code","slack","teams","notion","obsidian","brave","opera","vivaldi","electron","atom","sublime_text","notepad","wordpad","winword","onenote","outlook")',
    '    foreach ($a in $webApps) { if ($n -like "*$a*") { Write-Output 1; exit } }',
    '  }',
    '  Write-Output 0',
    '} catch { Write-Output 0 }'
  ].join('\r\n');
  try { fs.writeFileSync(checkFocusScript, ps, 'utf8'); }
  catch(e) { logger.warn('[textfield] script write failed:', e.message); checkFocusScript = null; }
  return checkFocusScript;
}

function detectTextField() {
  const ps = ensureCheckScript();
  if (!ps) { textFieldCheckPromise = Promise.resolve(false); return; }

  textFieldCheckPromise = new Promise((resolve) => {
    // Hard cap: if PS takes >900ms, default to false (don't risk a stray paste)
    const fallback = setTimeout(() => resolve(false), 900);

    // -NoProfile -NonInteractive: skip user profile = ~150ms faster startup
    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps}"`,
      { windowsHide: true, timeout: 1500 },
      (err, stdout) => {
        clearTimeout(fallback);
        const result = !err && stdout.trim() === '1';
        logger.info('[textfield]', result ? 'text input detected' : 'not in text input');
        resolve(result);
      }
    );
  });
}

// ── Paste ─────────────────────────────────────────────────────────────────────
// Primary: wscript VBScript (~30ms, no .NET runtime).
// Fallback: PowerShell -NoProfile (~150ms).

let pasteVbsPath = null;

function ensurePasteScript() {
  if (pasteVbsPath) return pasteVbsPath;
  pasteVbsPath = path.join(dataDir || app.getPath('userData'), 'paste.vbs');
  try {
    fs.writeFileSync(
      pasteVbsPath,
      'Set s=CreateObject("WScript.Shell")\r\ns.SendKeys "^v"\r\n',
      'utf8'
    );
  } catch(e) {
    logger.warn('[paste] vbs write failed:', e.message);
    pasteVbsPath = null;
  }
  return pasteVbsPath;
}

function sendPaste(delayMs = 450) {
  setTimeout(() => {
    const vbs = ensurePasteScript();
    if (vbs) {
      // wscript: Windows Scripting Host VBScript — starts in ~30ms
      exec(`wscript //NoLogo //B "${vbs}"`, { windowsHide: true }, (err) => {
        if (!err) return;
        logger.warn('[paste] wscript failed, trying PowerShell:', err.message);
        // Fallback: PowerShell with -NoProfile (no .NET profile load = faster)
        exec(
          'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$s=New-Object -ComObject WScript.Shell;$s.SendKeys(\'^v\')"',
          { windowsHide: true },
          (err2) => { if (err2) logger.warn('[paste] PS fallback also failed:', err2.message); }
        );
      });
    } else {
      exec(
        'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$s=New-Object -ComObject WScript.Shell;$s.SendKeys(\'^v\')"',
        { windowsHide: true }
      );
    }
  }, delayMs);
}

// ── Window position ───────────────────────────────────────────────────────────
function getWindowPos() {
  try {
    const cursor  = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
    const winW = 460, winH = 600;
    let x = cursor.x - Math.round(winW / 2);
    let y = cursor.y - winH - 10;
    if (y < wy) y = cursor.y + 24;
    x = Math.max(wx, Math.min(x, wx + ww - winW));
    y = Math.max(wy, Math.min(y, wy + wh - winH));
    return { x, y };
  } catch {
    // Fallback to centre if screen API fails
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { x: Math.round(width / 2 - 230), y: Math.round(height / 2 - 300) };
  }
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
    width:  460, height: 600,
    x: Math.round(width / 2 - 230),
    y: Math.round(height / 2 - 300),
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
      spellcheck:       false,
      enableWebSQL:     false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Renderer crash → recreate silently so hotkey keeps working
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('[renderer] crashed — reason:', details.reason, 'code:', details.exitCode);
    const win = mainWindow;
    mainWindow      = null;
    isWindowVisible = false;
    isAnimating     = false;
    if (win && !win.isDestroyed()) { try { win.destroy(); } catch {} }
    setTimeout(createWindow, 600);
  });

  // Page failed to load → reload once
  mainWindow.webContents.once('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    logger.warn('[renderer] load failed:', code, desc, '— reloading');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
      }
    }, 500);
  });

  mainWindow.on('blur', () => {
    if (isWindowVisible && !isAnimating) hideWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow      = null;
    isWindowVisible = false;
  });

  initUpdater(() => mainWindow);
}

function showWindow() {
  if (isAnimating) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();

  // Detect text field NOW — previous app still has focus before showInactive()
  detectTextField();

  try {
    const { x, y } = getWindowPos();
    mainWindow.setPosition(x, y);
  } catch {}

  isAnimating     = true;
  isWindowVisible = true;

  // Immediately capture any clipboard content copied since the last poll
  // so the list is always up-to-date the instant the window appears.
  pollNow();

  const doShow = () => {
    try {
      // showInactive: appears without stealing focus from whatever the user was typing in
      mainWindow.showInactive();
      mainWindow.webContents.send('window-showing');
    } catch(e) { logger.warn('[window] showInactive failed:', e.message); }
    setTimeout(() => { isAnimating = false; }, 350);
  };

  try {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', doShow);
    } else {
      doShow();
    }
  } catch(e) {
    isAnimating = false;
    logger.warn('[window] showWindow error:', e.message);
  }
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isAnimating) return;

  isAnimating     = true;
  isWindowVisible = false;

  try { mainWindow.webContents.send('window-hiding'); } catch {}
  setTimeout(() => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); } catch {}
    isAnimating = false;
  }, 200);
}

function toggleWindow() {
  if (isAnimating) return;
  if (isWindowVisible) hideWindow(); else showWindow();
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  try { tray = new Tray(makeTrayIcon()); }
  catch { tray = new Tray(nativeImage.createEmpty()); }
  tray.setToolTip('Clipboard Manager');
  tray.on('click', toggleWindow);
  updateTrayMenu('Alt+V');
}

function updateTrayMenu(hotkey) {
  try {
    tray.setToolTip(`Clipboard Manager — ${hotkey}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Open  (${hotkey})`, click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]));
  } catch {}
}

// ── IPC ───────────────────────────────────────────────────────────────────────
// safeHandle: wraps every handler in try-catch so a bug in one handler can
// never propagate to the renderer or crash the main process.
function safeHandle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try { return await fn(e, ...args); }
    catch(err) {
      logger.error(`[IPC] ${channel} threw:`, err.message || err);
      return null;
    }
  });
}

function setupIPC() {
  safeHandle('get-clipboard-history', (_e, opts) => queryHistory(opts || {}));

  safeHandle('copy-to-clipboard', (_e, { content }) => {
    clipboard.writeText(content);
    lastClipboardText = content;
    // Paste fires asynchronously once the text-field check resolves.
    // blur() hands focus back to the previous app BEFORE we paste —
    // without it, Discord/etc. won't have focus when Ctrl+V fires.
    textFieldCheckPromise.then(inField => {
      if (inField) {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur(); } catch {}
        sendPaste(500); // 500ms: 200ms hide animation + 300ms focus transfer buffer
      }
      hideWindow(); // always close the picker after copying
    }).catch(() => hideWindow());
    return true;
  });

  safeHandle('toggle-favorite', (_e, { id, value }) => {
    const item = historyData.items.find(i => i.id === id);
    if (item) { item.favorite = !!value; saveHistory(); }
    return true;
  });

  safeHandle('delete-clipboard-item', (_e, { id }) => {
    historyData.items = historyData.items.filter(i => i.id !== id);
    saveHistory();
    return true;
  });

  safeHandle('clear-clipboard-history', () => {
    historyData.items = historyData.items.filter(i => i.favorite);
    saveHistory();
    return true;
  });

  safeHandle('get-emoji-favorites', () => emojiData.favorites);

  safeHandle('toggle-emoji-favorite', (_e, { emoji, isFav }) => {
    if (isFav) {
      if (!emojiData.favorites.includes(emoji)) emojiData.favorites.unshift(emoji);
    } else {
      emojiData.favorites = emojiData.favorites.filter(e => e !== emoji);
    }
    saveEmojis();
    return true;
  });

  safeHandle('copy-emoji', (_e, { emoji }) => {
    clipboard.writeText(emoji);
    lastClipboardText = emoji;
    textFieldCheckPromise.then(inField => {
      if (inField) {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur(); } catch {}
        sendPaste(500);
      }
      hideWindow();
    }).catch(() => hideWindow());
    return true;
  });

  safeHandle('hide-window', () => hideWindow());

  safeHandle('get-stats', () => ({
    count:    historyData.items.length,
    favCount: historyData.items.filter(i => i.favorite).length
  }));

  safeHandle('install-update', () => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall(false, true);
    } catch(e) { logger.error('[updater] install failed:', e.message); }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  logger.info('[app] starting v' + app.getVersion(), '| packaged:', app.isPackaged);
  initStorage();
  setupIPC();
  createTray();
  startClipboardMonitor();
  registerStartup();

  // Pre-write helper scripts so first use has no file-write delay
  ensureCheckScript();
  ensurePasteScript();

  const candidates = ['Alt+V', 'CommandOrControl+Shift+V', 'CommandOrControl+Shift+C', 'Alt+Shift+V'];
  for (const hk of candidates) {
    if (globalShortcut.register(hk, toggleWindow)) {
      logger.info('[hotkey] registered:', hk);
      updateTrayMenu(hk);
      break;
    }
  }

  const launchHidden = process.argv.includes('--hidden');
  if (!launchHidden) { createWindow(); showWindow(); }
}).catch(err => logger.error('[app] whenReady failed:', err));

app.on('will-quit', () => {
  logger.info('[app] quitting — flushing storage');
  globalShortcut.unregisterAll();
  if (clipboardPoller) clearTimeout(clipboardPoller);
  flushSync();
});

app.on('window-all-closed', e => e.preventDefault());
