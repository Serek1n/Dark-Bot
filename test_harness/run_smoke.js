// Start-up smoke test: every bot module loads, the ready event runs, every undefined name in
// the voice/shop/leveling modules would show up here. Run: node test_harness/run_smoke.js
process.env.DATABASE_PATH = './data/test_smoke.sqlite';
const fs = require('fs'); const path = require('path');
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
(async () => {
  const db = require('../db'); await db.init();
  const bad = [];
  for (const f of [...walk('bot'), ...walk('db')]) {
    if (/deploy-commands|bot[\\/]index\.js$/.test(f)) continue; // these start the bot itself
    try { require(path.resolve(f)); } catch (e) { bad.push(`${f}: ${e.message}`); }
  }
  const client = { user: { tag: 'x#1', setActivity() {} }, guilds: { cache: new Map([['1', { id: '1', voiceStates: { cache: new Map() }, channels: { cache: new Map() } }]]) } };
  try { await require('../bot/events/ready').execute(client); } catch (e) { bad.push('ready: ' + e.message); }
  try { await require('../bot/modules/voiceTime').xpTick(client); } catch (e) { bad.push('xpTick: ' + e.message); }
  try { await require('../bot/modules/voiceTime').flushAll(); } catch (e) { bad.push('flushAll: ' + e.message); }
  console.log(bad.length ? '❌ ' + bad.join('\n❌ ') : '✅ всё загружается, ready/xpTick/flushAll отрабатывают');
  process.exit(bad.length ? 1 : 0);
})();
