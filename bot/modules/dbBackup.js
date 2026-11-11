// A copy of the database once a day, made by the bot itself (before, copies appeared only when the bot was updated —
// weeks could pass between them). The copy is made by scripts/backup-db.js in its own process: SQLite's VACUUM INTO
// gives a consistent file while the bot keeps working. DB_BACKUP=off switches it off.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DAY = 24 * 3600 * 1000;
const root = path.join(__dirname, '..', '..');

function lastDailyAt() {
  try {
    const dbFile = path.resolve(root, process.env.DATABASE_PATH || './data/dark.sqlite');
    const dir = path.join(path.dirname(dbFile), 'backups');
    const files = fs.readdirSync(dir).filter((f) => /-daily\.sqlite$/.test(f));
    return Math.max(0, ...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
  } catch { return 0; }
}

function runBackup() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts', 'backup-db.js'), 'daily'], { cwd: root, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) logger.warn(`Daily database copy failed: ${String(stderr || err.message).trim().slice(0, 300)}`);
      else logger.info(String(stdout).trim().split('\n').join('; '));
      resolve(!err);
    });
  });
}

let timer = null;
function startDbBackup() {
  if (String(process.env.DB_BACKUP || '').toLowerCase() === 'off' || timer) return;
  const check = () => { if (Date.now() - lastDailyAt() >= DAY) runBackup().catch(() => {}); };
  timer = setInterval(check, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(check, 2 * 60 * 1000).unref?.(); // not in the first seconds of a start
}

module.exports = { startDbBackup, runBackup, lastDailyAt };
