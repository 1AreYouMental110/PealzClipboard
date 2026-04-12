const fs   = require('fs');
const path = require('path');

// userData path unavailable until app is ready — resolved lazily
let _logPath = null;

function getLogPath() {
  if (_logPath) return _logPath;
  try {
    const { app } = require('electron');
    _logPath = path.join(app.getPath('userData'), 'app.log');
  } catch {
    _logPath = path.join(__dirname, 'app.log');
  }
  return _logPath;
}

function rotateIfNeeded() {
  try {
    const p = getLogPath();
    if (fs.existsSync(p) && fs.statSync(p).size > 2 * 1024 * 1024) {
      fs.writeFileSync(p, '', 'utf8'); // truncate, don't keep old log
    }
  } catch {}
}

function write(level, ...args) {
  const ts  = new Date().toISOString();
  const msg = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch {} }
    return String(a);
  }).join(' ');

  const line = `[${ts}] [${level}] ${msg}\n`;
  process.stdout.write(line);

  try {
    fs.appendFileSync(getLogPath(), line, 'utf8');
  } catch {}
}

// electron-updater expects a logger with these exact method names
const logger = {
  info:  (...a) => write('INFO',  ...a),
  warn:  (...a) => write('WARN',  ...a),
  error: (...a) => write('ERROR', ...a),
  debug: (...a) => write('DEBUG', ...a),
  // electron-updater compatibility shim
  transports: {
    file:    { level: 'info' },
    console: { level: 'info' }
  }
};

// Rotate on load (after app is ready, first call is deferred — safe)
process.nextTick(() => { try { rotateIfNeeded(); } catch {} });

module.exports = logger;
