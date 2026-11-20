// A flood of requests must not take the bot down with the panel (they share one process): limits per address, shedding
// when too much is being built, a micro-cache of public pages for anonymous visitors that random parameters cannot dodge,
// a forged session cookie is not «signed in»; commands and buttons limited per person; catalog counters written in batches;
// the nginx config carries its limits and timeouts.
process.env.DATABASE_PATH = './data/test_shield.sqlite';
process.env.SESSION_SECRET = 's'.repeat(40);
process.env.WEB_RATE_PER_MIN = '30';
process.env.WEB_RATE_HEAVY_PER_MIN = '10';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const express = require('express');
  const shield = require('../web/middleware/shield');
  const app = express();
  app.set('trust proxy', 1);
  let built = 0; let slow = null;
  app.use(shield);
  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/privacy', (req, res) => { built++; res.send('<p>policy ' + built + '</p>'); });
  app.get('/communities/:id(\\d+)', async (req, res) => { built++; if (slow) await slow; res.send('<p>community ' + built + '</p>'); });
  app.get('/dashboard', (req, res) => { built++; res.send('dash'); });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, ip = '1.1.1.1', cookie) => fetch(base + p, { headers: { 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) } });
  const signed = 'connect.sid=' + encodeURIComponent('s:' + require('cookie-signature').sign('abc', process.env.SESSION_SECRET));

  await test('anonymous visitors: a public page is built once in a few seconds; random parameters do not dodge it', async () => {
    shield.reset(); built = 0;
    const a = await (await get('/privacy', '2.0.0.1')).text();
    const r = await get('/privacy?x=' + Math.random(), '2.0.0.2');
    assert(r.headers.get('x-cache') === 'HIT' && (await r.text()) === a && built === 1, 'built ' + built);
    assert((await get('/communities/1?rpage=2', '2.0.0.3')).headers.get('x-cache') !== 'HIT', 'a real parameter is another page');
  });

  await test('signed in (a cookie with the panel\'s signature): no cache; a forged cookie is treated as anonymous', async () => {
    shield.reset(); built = 0;
    await get('/privacy', '3.0.0.1');
    assert((await get('/privacy', '3.0.0.2', signed)).headers.get('x-cache') !== 'HIT' && built === 2, 'signed: built anew');
    assert((await get('/privacy', '3.0.0.3', 'connect.sid=s%3Afake.sig')).headers.get('x-cache') === 'HIT', 'forged: cached');
  });

  await test('per address: over the limit — a short 429 with Retry-After; heavy public pages have a lower one', async () => {
    shield.reset();
    let r; for (let i = 0; i < 11; i++) r = await get('/communities/' + (i + 1), '4.0.0.1');
    assert(r.status === 429 && Number(r.headers.get('retry-after')) > 0 && /Слишком много запросов/.test(await r.text()), 'heavy ' + r.status);
    for (let i = 0; i < 31; i++) r = await get('/dashboard', '4.0.0.2');
    assert(r.status === 429, 'all ' + r.status);
    assert((await get('/dashboard', '4.0.0.3')).status === 200, 'another address is fine');
    for (let i = 0; i < 40; i++) r = await get('/healthz', '4.0.0.4');
    assert(r.status === 200, '/healthz is never limited');
  });

  await test('shedding: when too many pages are being built at once, a new anonymous one gets 503 at once', async () => {
    shield.reset();
    const keep = shield.CFG.maxInFlight; shield.CFG.maxInFlight = 2;
    let release; slow = new Promise((r) => { release = r; });
    const hanging = [get('/communities/50', '5.0.0.1'), get('/communities/51', '5.0.0.2')];
    await new Promise((r) => setTimeout(r, 50));
    const r = await get('/communities/52', '5.0.0.3');
    assert(r.status === 503 && r.headers.get('retry-after') === '5', 'shed ' + r.status);
    assert((await get('/dashboard', '5.0.0.4', signed)).status === 200, 'the signed in get a larger share');
    release(); slow = null; await Promise.all(hanging);
    assert(shield.stats().inFlight === 0, 'the count returns to zero');
    assert((await get('/communities/53', '5.0.0.5')).status === 200, 'free again');
    shield.CFG.maxInFlight = keep;
  });
  server.close();

  await test('commands and buttons: at most 12 in 10 s per person; told once, then ignored; others not affected', () => {
    const g = require('../bot/utils/interactionGuard'); g.reset();
    const t = 1000000; const v = [];
    for (let i = 0; i < 14; i++) v.push(g.check('u1', t + i));
    assert(v.slice(0, 12).every((x) => x === 'ok') && v[12] === 'tell' && v[13] === 'drop', v.join());
    assert(g.check('u2', t + 20) === 'ok', 'another person');
    assert(g.check('u1', t + 10001) === 'ok', 'a new window');
  });

  await test('the interaction handler applies the limit before any work', () => {
    const src = fs.readFileSync('bot/events/interactionCreate.js', 'utf8');
    assert(src.indexOf("interactionGuard').check") > 0 && src.indexOf("interactionGuard').check") < src.indexOf('isChatInputCommand()'), 'first');
  });

  await test('catalog views and clicks are written in one batch, not on every request', async () => {
    const db = require('../db'); await db.init();
    const cm = require('../bot/modules/communities');
    const c = await db.Community.create({ guildId: '800000000000000301', ownerId: '1', name: 'x', shortDesc: 'y', inviteUrl: 'https://discord.gg/x', status: 'published' });
    for (let i = 0; i < 25; i++) await cm.view(c.id, 'visitor' + i);
    await cm.click(c.id, 'a'); await cm.click(c.id, 'a');
    assert((await db.Community.findByPk(c.id)).views === 0, 'not written yet');
    await cm.flushStats();
    const row = await db.Community.findByPk(c.id);
    const [st] = await db.sequelize.query('SELECT views, clicks FROM community_stats WHERE communityId = ?', { replacements: [c.id], type: 'SELECT' });
    assert(row.views === 25 && row.clicks === 1 && st.views === 25 && st.clicks === 1, JSON.stringify({ v: row.views, c: row.clicks, st }));
  });

  await test('nginx config: limits per address and in total, short timeouts for slow clients, the real address passed on', () => {
    const n = fs.readFileSync('deploy/nginx/darkbot-space.conf', 'utf8');
    ['limit_req_zone  $binary_remote_addr zone=dark_pages', 'zone=dark_total', 'limit_conn dark_conn', 'client_header_timeout', 'client_body_timeout', 'proxy_set_header X-Forwarded-For $remote_addr', 'zone=dark_auth'].forEach((s) => assert(n.includes(s), s));
  });

  await test('the panel sets timeouts on its http server', () => {
    const src = fs.readFileSync('web/index.js', 'utf8');
    ['server.headersTimeout', 'server.requestTimeout', 'server.maxConnections', "require('./middleware/shield')"].forEach((s) => assert(src.includes(s), s));
  });

  await test('drawing queue: at most RENDER_CONCURRENCY at once, the rest wait; a too long queue refuses at once', async () => {
    const q = require('../bot/utils/renderQueue');
    let now = 0; let peak = 0;
    const job = q.limited(async (ms) => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, ms)); now--; return ms; });
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => job(20 + i)));
    assert(out.length === 10 && out[9] === 29 && peak === q.stats().max, 'peak ' + peak);
    const many = Array.from({ length: 70 }, () => job(5).then(() => 'ok', (e) => e.constructor.name));
    const res = await Promise.all(many);
    assert(res.includes('RenderBusy') && res.includes('ok'), 'refused when overloaded');
    assert(q.stats().active === 0 && q.stats().waiting === 0, 'drained');
  });

  await test('catalog pictures: a redirect to another site is refused (no fetching for an attacker)', async () => {
    const media = require('../bot/modules/communityMedia');
    const real = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, url: 'https://169.254.169.254/latest/meta-data', headers: new Map(), arrayBuffer: async () => new ArrayBuffer(8), body: null });
    let msg = '';
    try { await media.importUrl('800000000000000301', 'https://cdn.discordapp.com/attachments/1/2/a.png'); } catch (e) { msg = e.message; } finally { global.fetch = real; }
    assert(/другой сайт/.test(msg), msg);
  });

  await test('sessions: the expiry is written at most every 10 minutes per session, not on every click', async () => {
    const db = require('../db'); await db.init().catch(() => {});
    const { SequelizeStore } = require('../web/sessionStore');
    const store = new SequelizeStore();
    const p = (f) => new Promise((res, rej) => f((e, v) => (e ? rej(e) : res(v))));
    const sess = { cookie: { expires: new Date(Date.now() + 3600e3) } };
    await p((cb) => store.set('t1', sess, cb));
    let writes = 0; const q = db.sequelize.query.bind(db.sequelize);
    db.sequelize.query = (...a) => { if (/^UPDATE web_sessions/.test(a[0])) writes++; return q(...a); };
    for (let i = 0; i < 20; i++) await p((cb) => store.touch('t1', sess, cb));
    store.touched.set('t1', Date.now() - 11 * 60e3);
    await p((cb) => store.touch('t1', sess, cb));
    db.sequelize.query = q;
    assert(writes === 1, 'writes ' + writes);
  });

  await test('after signing in, «Мои данные» is a place to come back to; other sites never are', () => {
    const { safeNext } = require('../web/routes/auth');
    assert(safeNext('/me') === '/me' && safeNext('/wallet') === '/wallet' && safeNext('//evil.example') === null && safeNext('https://evil.example') === null && safeNext('/me/../x') === null, 'safeNext');
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
