// The server picker: fresh list from Discord, current names, token renewal, fallback to the saved list.
process.env.DATABASE_PATH = './data/test_guilds.sqlite';
process.env.DISCORD_CLIENT_ID = 'cid'; process.env.DISCORD_CLIENT_SECRET = 'sec';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const A = '100000000000000001', B = '100000000000000002', C = '100000000000000003', D = '100000000000000004', E = '100000000000000005';
const ME = 0x20, NONE = 0;
const discord = { guilds: [], tokenOk: true, down: false, calls: [] };
const axios = require('axios'); const realCreate = axios.create;
axios.create = () => ({
  get: async (u, c) => { discord.calls.push(['GET', c.headers.Authorization]); if (discord.down) throw new Error('net'); if (!discord.tokenOk || c.headers.Authorization !== 'Bearer new-token' && discord.requireNew) throw Object.assign(new Error('401'), { response: { status: 401 } }); return { data: discord.guilds }; },
  post: async () => { discord.calls.push(['REFRESH']); discord.requireNew = true; discord.tokenOk = true; return { data: { access_token: 'new-token', refresh_token: 'r2' } }; }
});
const user = { id: 'U', accessToken: 'old', refreshToken: 'r1', guilds: [{ id: A, name: 'Старое имя', icon: null, permissions: String(ME) }, { id: B, name: 'Второй', icon: null, permissions: String(ME) }] };
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => { q.user = user; n(); } });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuilds: async () => new Map([[A, { id: A, name: 'Новое имя', icon: 'ic' }], [C, { id: C, name: 'Третий', icon: null }], [E, { id: E, name: 'Чужой', icon: null }]]), getBotGuildIds: async () => new Set([A, C, E]), getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');
(async () => {
  const db = require('../db'); await db.init();
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use('/dashboard', require('../web/routes/dashboard')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  const server = app.listen(0); const page = () => fetch(`http://127.0.0.1:${server.address().port}/dashboard`).then((r) => r.text());
  const names = (html) => [...html.matchAll(/class="name">([^<]*)</g)].map((m) => m[1]);

  await test('a new server appears without logging in again, the bot\'s current name is shown, the bot servers come first', async () => {
    discord.requireNew = false; discord.tokenOk = true;
    discord.guilds = [{ id: A, name: 'Старое имя', permissions: String(ME) }, { id: B, name: 'Второй', permissions: String(ME) }, { id: C, name: 'Третий (стар.)', permissions: String(ME) }, { id: D, name: 'Без прав', permissions: String(NONE) }, { id: E, name: 'Чужой', permissions: '8' }];
    const n = names(await page());
    assert(n.join() === 'Новое имя,Третий,Чужой,Второй', n.join() + ' (no rights server hidden, bot first, live names)');
    assert(user.guilds.length === 5, 'session list updated');
  });
  await test('more than two servers: all manageable ones are listed', async () => {
    assert(names(await page()).length === 4, 'four');
  });
  await test('an expired token is renewed once and the list still loads', async () => {
    discord.calls.length = 0; discord.tokenOk = false; discord.requireNew = false;
    const n = names(await page());
    assert(n.length === 4 && discord.calls.some((c) => c[0] === 'REFRESH') && user.accessToken === 'new-token' && user.refreshToken === 'r2', 'refreshed ' + JSON.stringify(discord.calls));
  });
  await test('when Discord is unreachable the saved list is used instead of an error', async () => {
    discord.down = true; const html = await page(); discord.down = false;
    assert(names(html).length === 4 && !html.includes('Error'), 'fallback');
  });
  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
