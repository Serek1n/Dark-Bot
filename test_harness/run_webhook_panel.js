// Webhooks page of the panel: list, create, delete, send; the log webhook and foreign ones stay untouched.
process.env.DATABASE_PATH = './data/test_webhook_panel.sqlite';
process.env.DISCORD_CLIENT_ID = 'BOTAPP';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const calls = []; let hooks = [];
const botApi = {
  get: async (u) => { calls.push(['GET', u]); if (u.endsWith('/webhooks')) return { data: hooks }; if (u === '/users/@me') return { data: { id: 'BOTAPP', avatar: null } }; throw new Error('unexpected ' + u); },
  post: async (u, body) => { calls.push(['POST', u, body]); if (botApi.failWith) throw botApi.failWith; const h = { id: 'NEW' + calls.length, name: body.name, channel_id: u.split('/')[2], application_id: 'BOTAPP', token: 'tk' }; hooks.push(h); return { data: h }; },
  delete: async (u) => { calls.push(['DELETE', u]); hooks = hooks.filter((h) => !u.endsWith('/' + h.id)); return {}; }
};
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'новости', type: 0 }, { id: '123456789012345679', name: 'категория', type: 4 }],
  getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi
});
stub('middleware/rateLimit.js', { rateLimit: () => (q, s, n) => n() }); // the limit itself is tested in run_security.js
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const webhooks = require('../web/webhooks');
  const sent = [];
  const axios = require('axios');
  const origPost = axios.post; axios.post = async (u, b) => { sent.push([u, b]); return {}; };
  const origGet = axios.get; axios.get = async () => ({ data: Buffer.from('png'), headers: { 'content-type': 'image/png' } });
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const G = '777000000000000001'; const CH = '123456789012345678';
  await db.GuildSettings.create({ guildId: G, logWebhookId: 'LOGHOOK' });
  hooks = [{ id: 'H1', name: 'Новости', channel_id: CH, application_id: 'BOTAPP', token: 'tok1' }, { id: 'H2', name: 'Чужой', channel_id: CH, application_id: 'OTHER', token: 'tok2' }, { id: 'LOGHOOK', name: 'Логи', channel_id: CH, application_id: 'BOTAPP', token: 'tok3' }, { id: 'H4', name: 'Без токена', channel_id: CH, application_id: 'BOTAPP' }];

  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}/webhooks`;
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const loc = (r) => r.headers.get('location');

  await test('page lists only this bot\'s webhooks that have a link; not the log, foreign or tokenless ones', async () => {
    const html = await (await fetch(base)).text();
    assert(html.includes('Новости') && html.includes('webhooks/H1/tok1'), 'own listed');
    assert(!html.includes('Чужой') && !html.includes('tok3') && !html.includes('Без токена'), 'others hidden');
    assert(html.includes('новости') && !html.includes('категория'), 'only channels that can have webhooks');
  });
  await test('create: webhook is made in the chosen channel with the entered name', async () => {
    const r = await post('', { channelId: CH, name: '  Анонсы  ' });
    assert(loc(r).includes('created=1'), loc(r));
    const c = calls.find((x) => x[0] === 'POST'); assert(c[1] === `/channels/${CH}/webhooks` && c[2].name === 'Анонсы', JSON.stringify(c));
  });
  await test('create: bad input is refused and nothing is sent to Discord (empty name, non-webhook channel, unknown channel)', async () => {
    const n = calls.filter((x) => x[0] === 'POST').length;
    for (const body of [{ channelId: CH, name: '  ' }, { channelId: '123456789012345679', name: 'x' }, { channelId: '999999999999999999', name: 'x' }, { name: 'x' }]) {
      assert(loc(await post('', body)).includes('invalid=1'), JSON.stringify(body));
    }
    assert(calls.filter((x) => x[0] === 'POST').length === n, 'no calls');
  });
  await test('create: Discord errors turn into a readable message on the page', async () => {
    botApi.failWith = Object.assign(new Error('x'), { response: { status: 400, data: { code: 30007, message: 'Maximum number of webhooks reached (15)' } } });
    assert(decodeURIComponent(loc(await post('', { channelId: CH, name: 'x' }))).includes('уже 15'), 'limit');
    botApi.failWith = Object.assign(new Error('x'), { response: { status: 403, data: { code: 50013, message: 'Missing Permissions' } } });
    assert(decodeURIComponent(loc(await post('', { channelId: CH, name: 'x' }))).includes('нет права'), 'perm');
    botApi.failWith = null;
  });
  await test('delete: own webhook is removed; foreign, log and unknown ones are refused', async () => {
    const before = calls.filter((x) => x[0] === 'DELETE').length;
    for (const id of ['H2', 'LOGHOOK', 'NOPE', 'H4']) assert(loc(await post(`/${id}/delete`, {})).includes('invalid=1'), id);
    assert(calls.filter((x) => x[0] === 'DELETE').length === before, 'no deletes');
    assert(loc(await post('/H1/delete', {})).includes('deleted=1') && calls.some((x) => x[0] === 'DELETE' && x[1] === '/webhooks/H1'), 'own deleted');
  });
  await test('send: goes through the webhook link with no mentions parsed; foreign ones are refused', async () => {
    hooks.push({ id: 'H5', name: 'Тест', channel_id: CH, application_id: 'BOTAPP', token: 'tok5' });
    assert(loc(await post('/H5/send', { content: '@everyone привет', username: 'Диктор' })).includes('whsent=1'), 'sent');
    assert(sent[0][0].endsWith('/webhooks/H5/tok5') && sent[0][1].username === 'Диктор' && sent[0][1].allowed_mentions.parse.length === 0, JSON.stringify(sent));
    assert(loc(await post('/H5/send', { content: '   ' })).includes('invalid=1') && loc(await post('/H2/send', { content: 'x' })).includes('invalid=1') && sent.length === 1, 'refused');
  });
  await test('avatar from a link: https and public hosts only', async () => {
    assert((await webhooks.fetchAvatar('https://93.184.216.34/a.png')).startsWith('data:image/png;base64,'), 'ok');
    for (const bad of ['http://example.com/a.png', 'https://127.0.0.1/a.png', 'https://10.1.2.3/a.png', 'https://169.254.169.254/x', 'https://[::1]/a.png', 'ftp://x/a', 'не ссылка']) {
      let err = null; await webhooks.fetchAvatar(bad).catch((e) => { err = e; }); assert(err, 'must refuse ' + bad);
    }
    axios.get = async () => ({ data: Buffer.from('x'), headers: { 'content-type': 'text/html' } });
    let err = null; await webhooks.fetchAvatar('https://93.184.216.34/a').catch((e) => { err = e; }); assert(err && err.message.includes('PNG'), 'non-image');
  });
  await test('the page works when Discord refuses the list (no right) and the feature page links here', async () => {
    const saveGet = botApi.get; botApi.get = async () => { throw Object.assign(new Error('x'), { response: { status: 403, data: {} } }); };
    const html = await (await fetch(base)).text(); botApi.get = saveGet;
    assert(html.includes('Не удалось загрузить список'), 'error shown');
    assert(require('../bot/utils/features').FEATURES.find((f) => f.key === 'webhooks').page === 'webhooks', 'link');
  });

  server.close(); axios.post = origPost; axios.get = origGet;
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
