// A consistent copy of the database while the bot keeps running (SQLite "VACUUM INTO"), into data/backups/.
// Used by scripts/update.sh before every switch of version; the 10 newest copies are kept.
//   node scripts/backup-db.js [label]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const root = path.join(__dirname, '..');
const dbFile = path.resolve(root, process.env.DATABASE_PATH || './data/dark.sqlite');
const dir = path.join(path.dirname(dbFile), 'backups');
const label = String(process.argv[2] || 'manual').replace(/[^\w.-]/g, '_').slice(0, 40);
const KEEP = 10;

if (!fs.existsSync(dbFile)) { console.log('База ещё не создана — копировать нечего.'); process.exit(0); }
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const out = path.join(dir, `${path.basename(dbFile, '.sqlite')}-${stamp}-${label}.sqlite`);
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error('Не удалось открыть базу:', err.message); process.exit(1); }
  db.configure('busyTimeout', 10000);
  db.run('VACUUM INTO ?', [out], (e) => {
    db.close();
    if (e) { console.error('Копия не сделана:', e.message); process.exit(1); }
    try { fs.chmodSync(out, 0o600); } catch { /* best effort */ }
    const old = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse().slice(KEEP);
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
    console.log(`Копия базы: ${path.relative(root, out)}`);
  });
});
