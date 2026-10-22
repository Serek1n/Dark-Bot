// Security: CSRF, rate limits, secrets, SSRF, atomic balance edits, fresh rights, log redaction.
process.env.DATABASE_PATH = './data/test_security.sqlite';
process.env.DISCORD_CLIENT_ID = 'BOTAPP'; process.env.DISCORD_CLIENT_SECRET = 'secret'; process.env.DISCORD_TOKEN = 'x';
process.env.WEB_BASE_URL = 'https://panel.example.com'; process.env.SESSION_SECRET = 'a'.repeat(40);
const fs = require('fs'); const path = require('path'); const os = require('os');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
// the Discord side is faked; the real middleware, routes and app are used
stub('discordApi.js', { getBotGuildIds: async () => new Set(['777000000000000001', '777000000000000002']), getBotGuilds: async () => new Map(), getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const errorView = (app) => { app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); };

  // ---------- CSRF ----------
  const { csrfGuard } = require('../web/middleware/csrf');
  await test('CSRF: a change without Origin/Referer, with "null" or from another site is refused; our own site and GET pass', async () => {
    const app = express(); errorView(app); app.use(csrfGuard); app.all('/x', (q, s) => s.send('ok'));
    const server = app.listen(0); const url = `http://127.0.0.1:${server.address().port}/x`;
    const code = async (method, headers = {}) => (await fetch(url, { method, headers })).status;
    assert(await code('POST') === 403, 'no origin');
    assert(await code('POST', { origin: 'null' }) === 403, 'origin null');
    assert(await code('POST', { origin: 'https://evil.example' }) === 403, 'foreign origin');
    assert(await code('POST', { referer: 'https://evil.example/page' }) === 403, 'foreign referer');
    assert(await code('POST', { origin: 'https://evil.example', referer: url }) === 403, 'foreign origin wins over a good referer');
    assert(await code('POST', { origin: new URL(url).origin }) === 200, 'same origin');
    assert(await code('POST', { referer: url }) === 200, 'same-site referer');
    assert(await code('POST', { origin: 'https://panel.example.com' }) === 200, 'configured address (behind nginx)');
    assert(await code('DELETE') === 403 && await code('PUT') === 403, 'other methods');
    assert(await code('GET') === 200, 'GET');
    server.close();
  });

  // ---------- rate limit ----------
  const { rateLimit } = require('../web/middleware/rateLimit');
  await test('rate limit: over the limit gets 429 with Retry-After, per user, and the window resets', async () => {
    let now = 1_000_000; let who = 'u1';
    const app = express(); errorView(app);
    app.use((q, s, n) => { q.user = { id: who }; n(); });
    app.use(rateLimit({ windowMs: 60_000, max: 3, now: () => now }));
    app.get('/x', (q, s) => s.send('ok'));
    const server = app.listen(0); const url = `http://127.0.0.1:${server.address().port}/x`;
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await fetch(url)).status);
    assert(codes.join() === '200,200,200,429,429', codes.join());
    const limited = await fetch(url); assert(Number(limited.headers.get('retry-after')) > 0, 'Retry-After');
    who = 'u2'; assert((await fetch(url)).status === 200, 'another user is not affected');
    who = 'u1'; now += 61_000; assert((await fetch(url)).status === 200, 'window reset');
    server.close();
  });

  // ---------- secret ----------
  await test('SESSION_SECRET: missing, placeholder or short values stop the panel from starting', async () => {
    const { requireSessionSecret } = require('../web/security');
    for (const bad of [undefined, '', 'change-me', 'CHANGE-ME', 'short', 'x'.repeat(23)]) { let t = false; try { requireSessionSecret({ SESSION_SECRET: bad }); } catch { t = true; } assert(t, 'must refuse ' + bad); }
    assert(requireSessionSecret({ SESSION_SECRET: 'f'.repeat(32) }), 'good one passes');
  });

  // ---------- the real app ----------
  const { app } = require('../web/index');
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  await test('app: GET /auth/logout is gone; POST /auth/logout needs a same-site origin', async () => {
    assert((await fetch(base + '/auth/logout', { redirect: 'manual' })).status === 404, 'GET gone');
    assert((await fetch(base + '/auth/logout', { method: 'POST', redirect: 'manual' })).status === 403, 'POST without origin');
    assert((await fetch(base + '/auth/logout', { method: 'POST', redirect: 'manual', headers: { origin: base } })).status < 400, 'POST from the site');
  });
  await test('app: a foreign site cannot change anything in the dashboard (403 before any login check)', async () => {
    const r = await fetch(base + '/dashboard/777000000000000001/economy/grant', { method: 'POST', redirect: 'manual', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'userId=1&amount=999' });
    assert(r.status === 403, String(r.status));
  });
  await test('app: login attempts and dashboard changes are rate limited', async () => {
    let last = 0; for (let i = 0; i < 32; i++) last = (await fetch(base + '/auth/login', { redirect: 'manual' })).status;
    assert(last === 429, 'login limit, got ' + last);
    const codes = []; for (let i = 0; i < 125; i++) codes.push((await fetch(base + '/dashboard/777000000000000001/x', { method: 'POST', redirect: 'manual', headers: { origin: base } })).status);
    assert(codes.includes(429) && codes[0] !== 429, 'change limit ' + codes.slice(-3));
  });
  server.close();

  // ---------- rights ----------
  await test('rights: no access to another server; a lost role is noticed; unconfirmed rights expire', async () => {
    const userGuilds = require('../web/utils/userGuilds');
    const original = userGuilds.refreshUserGuilds;
    let list = [{ id: '777000000000000001', permissions: String(0x20) }];
    const mw = require('../web/middleware/ensureGuildAccess');
    const run = async (guildId, user) => { const out = { status: 200, next: false }; const res = { status: (c) => { out.status = c; return res; }, render: () => {} }; await mw.ensureGuildAccess({ params: { guildId }, user }, res, () => { out.next = true; }); return out; };
    const user = { id: 'U1', guilds: list, guildsAt: Date.now(), guildsOkAt: Date.now(), accessToken: 't' };
    const axios = require('axios'); const realGet = axios.create; // refreshUserGuilds uses its own axios instance: drive it through the saved list instead
    user.guildsAt = Date.now(); // inside the 20 s window the saved list is used
    assert((await run('777000000000000001', user)).next === true, 'admin of server 1');
    assert((await run('777000000000000002', user)).status === 403, 'not admin of server 2');
    user.guilds = []; assert((await run('777000000000000001', user)).status === 403, 'role removed -> refused');
    const old = { id: 'U2', guilds: list, guildsAt: Date.now(), guildsOkAt: Date.now() - 2 * 3600_000 };
    assert((await run('777000000000000001', old)).status === 401, 'rights not confirmed for 2 hours -> sign in again');
    assert(userGuilds.isStale({ guildsOkAt: Date.now() }) === false && userGuilds.isStale({ guildsOkAt: Date.now() - 2 * 3600_000 }) === true, 'isStale');
  });

  // ---------- SSRF ----------
  const webhooks = require('../web/webhooks');
  await test('SSRF: internal, mapped and special addresses are blocked, public ones pass', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '[::1]', 'не адрес']) assert(webhooks.isPrivateIp(ip), 'must block ' + ip);
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) assert(!webhooks.isPrivateIp(ip), 'must allow ' + ip);
  });
  await test('SSRF: the address is checked when connecting - a name that turns internal is refused (DNS rebinding)', async () => {
    let answer = [{ address: '93.184.216.34', family: 4 }];
    const lookup = webhooks.safeLookup((host, opts, cb) => cb(null, answer));
    const ask = (opts = {}) => new Promise((resolve) => lookup('evil.example', opts, (err, a, f) => resolve({ err, a, f })));
    assert((await ask()).a === '93.184.216.34', 'public ok');
    assert(Array.isArray((await ask({ all: true })).a), 'all: array');
    answer = [{ address: '127.0.0.1', family: 4 }]; assert((await ask()).err?.code === 'EBLOCKED', 'turned internal');
    answer = [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]; assert((await ask()).err?.code === 'EBLOCKED', 'one internal among public');
    answer = []; assert((await ask()).err, 'no answer');
  });
  await test('SSRF: the client uses the checking agent, no redirects, size limit; literal internal addresses never reach it', async () => {
    const axios = require('axios'); let cfg = null; const realGet = axios.get;
    axios.get = async (u, c) => { cfg = c; return { data: Buffer.from('x'), headers: { 'content-type': 'image/png' } }; };
    await webhooks.fetchAvatar('https://93.184.216.34/a.png');
    assert(cfg.httpsAgent && cfg.maxRedirects === 0 && cfg.maxContentLength <= 8 * 1024 * 1024, JSON.stringify(Object.keys(cfg)));
    cfg = null; let err = null; await webhooks.fetchAvatar('https://169.254.169.254/latest').catch((e) => { err = e; });
    assert(err && cfg === null, 'literal metadata address refused before any request');
    axios.get = realGet;
  });

  // ---------- atomic balance and level edits ----------
  const G = '777000000000000001'; const U = '555000000000000001';
  const gr = express(); errorView(gr); gr.use(express.urlencoded({ extended: true }));
  stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
  stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
  for (const k of Object.keys(require.cache)) if (k.includes(require('path').join('web', 'routes', 'dashboard'))) delete require.cache[k]; // the index and every page file, so they pick up the stubs above
  gr.use('/dashboard', require('../web/routes/dashboard'));
  gr.use((err, q, s, n) => s.status(500).send(String(err.stack)));
  const gs = gr.listen(0); const gbase = `http://127.0.0.1:${gs.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(gbase + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const { MemberProfile, sequelize } = db;
  await test('balance edits from the panel do not lose the bot\'s simultaneous payouts', async () => {
    await MemberProfile.findOrCreate({ where: { guildId: G, userId: U } });
    await MemberProfile.update({ balance: 100 }, { where: { guildId: G, userId: U } });
    const jobs = [];
    for (let i = 0; i < 30; i++) {
      jobs.push(post('/economy/grant', { userId: U, currency: 'coins', amount: '5' }));
      jobs.push(sequelize.query('UPDATE member_profiles SET balance = balance + 1 WHERE guildId = :g AND userId = :u', { replacements: { g: G, u: U } }));
    }
    await Promise.all(jobs);
    const p = await MemberProfile.findOne({ where: { guildId: G, userId: U } });
    assert(p.balance === 100 + 30 * 5 + 30, 'balance ' + p.balance);
  });
  await test('taking away more than the member has leaves 0, never a negative number', async () => {
    await post('/economy/grant', { userId: U, currency: 'coins', amount: '-999999' });
    assert((await MemberProfile.findOne({ where: { guildId: G, userId: U } })).balance === 0, 'zero');
    await post('/economy/grant', { userId: U, currency: 'crystals', amount: '-5' });
    assert((await MemberProfile.findOne({ where: { guildId: G, userId: U } })).crystals === 0, 'crystals zero');
  });
  await test('level edits retry when the bot changed the row in between, and still succeed', async () => {
    const realUpdate = MemberProfile.update.bind(MemberProfile); let first = true;
    MemberProfile.update = async (v, o) => { if (first && o?.where?.xp !== undefined) { first = false; await realUpdate({ xp: sequelize.literal('xp + 7') }, { where: { guildId: G, userId: U } }); } return realUpdate(v, o); };
    const r = await post('/leveling/adjust', { userId: U, mode: 'set', amount: '3' });
    MemberProfile.update = realUpdate;
    assert(r.headers.get('location').includes('adjusted=1') && (await MemberProfile.findOne({ where: { guildId: G, userId: U } })).level === 3, r.headers.get('location'));
  });
  await test('webhook actions are limited to 10 a minute per user', async () => {
    const codes = []; for (let i = 0; i < 13; i++) codes.push((await post('/webhooks', { channelId: 'bad', name: '' })).status);
    assert(codes.slice(0, 10).every((c) => c === 302) && codes.slice(10).every((c) => c === 429), codes.join());
  });
  gs.close();

  // ---------- logs, audit, yt-dlp ----------
  await test('log lines hide webhook links and tokens', async () => {
    const { redact } = require('../bot/utils/logger');
    const hook = 'https://discord.com/api/webhooks/123456789012345678/' + 'Ab1-'.repeat(17);
    assert(!redact(hook).includes('Ab1-Ab1-'), 'webhook link'); assert(!redact(new Error('failed ' + hook)).includes('Ab1-Ab1-'), 'inside an error');
    assert(!redact('Bot ' + 'x'.repeat(40)).includes('xxxxxxxx'), 'bot token');
    assert(redact('обычное сообщение') === 'обычное сообщение' && redact(42) === 42, 'normal text untouched');
  });
  await test('panel audit: one log line per change with the user and the path, without the form contents', async () => {
    const logger = require('../bot/utils/logger'); const lines = []; const real = logger.info; logger.info = (...a) => lines.push(a.join(' '));
    const { panelAudit } = require('../web/middleware/panelAudit');
    const app = express(); errorView(app); app.use(express.urlencoded({ extended: true })); app.use((q, s, n) => { q.user = { id: 'ADMIN1' }; n(); }); app.use(panelAudit); app.post('/webhooks/123456789012345678/send', (q, s) => s.send('ok')); app.get('/x', (q, s) => s.send('ok'));
    const server = app.listen(0); const u = `http://127.0.0.1:${server.address().port}`;
    await fetch(u + '/webhooks/123456789012345678/send?a=1', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'content=SECRETTEXT' }); await fetch(u + '/x');
    await new Promise((r) => setTimeout(r, 50)); server.close(); logger.info = real;
    assert(lines.length === 1 && lines[0].includes('ADMIN1') && lines[0].includes('POST') && lines[0].includes('webhooks/<id>/send') && !lines[0].includes('SECRETTEXT') && !lines[0].includes('?a=1'), lines.join('|'));
  });
  await test('yt-dlp: an answer bigger than the limit is cut off instead of filling the memory', async () => {
    const bin = path.join(os.tmpdir(), 'fake-ytdlp-' + process.pid + '.sh'); fs.writeFileSync(bin, '#!/bin/sh\nhead -c 30000000 /dev/zero | tr "\\0" "a"\n', { mode: 0o755 });
    process.env.YTDLP_PATH = bin; delete require.cache[require.resolve('../bot/modules/music/player')];
    const { ytDlpJson } = require('../bot/modules/music/player'); let err = null; await ytDlpJson(['x'], 20000).catch((e) => { err = e; });
    fs.rmSync(bin, { force: true }); assert(err && err.message.includes('слишком большой'), String(err && err.message));
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
