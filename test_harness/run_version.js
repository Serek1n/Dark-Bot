// Versions of the bot and the panel: read from version.json and git, shown in the side menu, on the overview and the server list.
process.env.DATABASE_PATH = './data/test_version.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map([[G, { id: G, name: 'T', icon: null }]]), getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
stub('utils/userGuilds.js', { refreshUserGuilds: async () => [{ id: G, name: 'T', icon: null, owner: true, permissions: '8' }], isStale: () => false });
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
(async () => {
  const db = require('../db'); await db.init();
  const ver = require('../bot/utils/version');
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
  await test('version.json gives both numbers; package.json follows the bot version', async () => {
    const v = ver.versionInfo();
    assert(/^\d+\.\d+\.\d+$/.test(v.bot) && /^\d+\.\d+\.\d+$/.test(v.panel) && v.bot === file.bot && v.panel === file.panel);
    assert.strictEqual(require('../package.json').version, file.bot, 'package.json version = bot version');
    assert(!('channel' in v) && v.node === process.versions.node && v.discordJs);
  });
  await test('uptime in words', async () => {
    assert.strictEqual(ver.formatUptime(30), '1 мин'); assert.strictEqual(ver.formatUptime(3 * 3600 + 5 * 60), '3 ч 5 мин'); assert.strictEqual(ver.formatUptime(2 * 86400 + 3 * 3600), '2 д 3 ч');
  });
  await test('git: branch and commit are read from the .git folder when there is no git command', async () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ver-'));
    // a fake checkout: reuse the module with ROOT pointing at it by copying the files it needs
    fs.mkdirSync(path.join(tmp, 'bot', 'utils'), { recursive: true }); fs.mkdirSync(path.join(tmp, '.git', 'refs', 'heads'), { recursive: true });
    for (const f of ['version.js']) fs.copyFileSync(path.join(__dirname, '..', 'bot', 'utils', f), path.join(tmp, 'bot', 'utils', f));
    fs.writeFileSync(path.join(tmp, 'version.json'), '{"bot":"9.1.0","panel":"9.2.0"}');
    fs.writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(tmp, '.git', 'refs', 'heads', 'main'), 'abcdef1234567890\n');
    const realPath = process.env.PATH; process.env.PATH = '/nonexistent'; // no git command
    const v = require(path.join(tmp, 'bot', 'utils', 'version.js')).versionInfo();
    process.env.PATH = realPath;
    assert(v.bot === '9.1.0' && v.panel === '9.2.0' && v.branch === 'main' && v.commit === 'abcdef1', JSON.stringify(v));
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use((q, r, n) => { q.user = { id: '1', username: 'x' }; r.locals.user = q.user; const { systemInfo, buildLine } = require('../web/utils/systemInfo'); r.locals.sys = systemInfo(); r.locals.sysLine = buildLine(r.locals.sys); n(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard`;
  await test('panel: the side menu and the overview show both versions and the bot state', async () => {
    const html = await (await fetch(`${base}/${G}`)).text();
    assert(html.includes(`Бот <b>v${file.bot}</b>`) && html.includes(`Панель <b>v${file.panel}</b>`), 'side menu');
    assert(html.includes('О версии') && html.includes('не в сети'), 'overview card; no bot in this test');
    require('../web/botBridge').setClient({ isReady: () => true, ws: { ping: 42 }, guilds: { cache: new Map([[G, {}]]) } });
    const on = await (await fetch(`${base}/${G}`)).text();
    assert(on.includes('в сети · 42 мс') && on.includes('серверов: 1'), 'online');
    require('../web/botBridge').setClient(null);
  });
  await test('server list shows the versions too', async () => {
    const html = await (await fetch(`${base}`)).text();
    assert(html.includes(`Бот v${file.bot} · Панель v${file.panel}`), html.slice(0, 300));
  });
  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
