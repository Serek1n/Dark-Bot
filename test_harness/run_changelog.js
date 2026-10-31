// "Обновления": the changelog of the bot and the panel, its page, and the notes the bot posts into a chosen channel.
process.env.DATABASE_PATH = './data/test_changelog.sqlite';
process.env.BOT_CHANNEL = 'release'; // the checkout may be the beta branch (CI on beta): these tests are about the release behaviour
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', G2 = '777000000000000002', CH = '800000000000000001', VOICE = '800000000000000002';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const posted = []; let failWith = null;
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getGuildRoles: async () => [], getUsers: async () => ({}),
  getGuildChannels: async () => [{ id: CH, name: 'новости', type: 0 }, { id: VOICE, name: 'голос', type: 2 }],
  getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: { post: async (u, body) => { if (failWith) throw failWith; posted.push([u, body]); return { data: { id: 'm' } }; }, get: async () => ({ data: {} }) }
});
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
(async () => {
  const db = require('../db'); await db.init();
  const updates = require('../bot/modules/updates');
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

  await test('changelog.json: newest first, matches version.json, every entry short and complete', async () => {
    const list = updates.releases();
    assert(list.length >= 1);
    assert(list[0].bot === version.bot && list[0].panel === version.panel, 'the newest entry is the running version');
    const cmp = (a, b) => a.split('.').map(Number).reduce((r, x, i) => r || x - b.split('.').map(Number)[i], 0);
    for (let i = 1; i < list.length; i++) assert(cmp(list[i - 1].bot, list[i].bot) >= 0 && cmp(list[i - 1].panel, list[i].panel) >= 0, 'ordered');
    for (const r of list) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(r.date), 'date ' + r.id);
      for (const x of [...r.botChanges, ...r.panelChanges]) assert(typeof x === 'string' && x.length > 0 && x.length <= 90, 'short: ' + x);
    }
    assert.strictEqual(new Set(list.map((r) => r.id)).size, list.length, 'unique versions');
  });

  await test('newerThan: unknown = everything (max 3); known = only the newer ones', async () => {
    const list = updates.releases();
    assert.strictEqual(updates.newerThan(null).length, Math.min(3, list.length));
    assert.strictEqual(updates.newerThan(list[0].id).length, 0);
    if (list.length > 1) assert.deepStrictEqual(updates.newerThan(list[1].id).map((r) => r.id), [list[0].id]);
  });

  await test('the message: title with both versions, "Бот" and "Веб-панель" lists', async () => {
    const e = updates.releaseEmbed({ bot: '9.9.9', panel: '8.8.8', date: '2026-01-02', botChanges: ['a'], panelChanges: ['b', 'c'] }, { panelUrl: 'https://x/dashboard/1/changelog' }).toJSON();
    assert(e.title.includes('v9.9.9') && e.title.includes('v8.8.8') && e.url === 'https://x/dashboard/1/changelog');
    assert(e.fields[0].name === 'Бот' && e.fields[0].value === '• a' && e.fields[1].name === 'Веб-панель' && e.fields[1].value === '• b\n• c');
    assert.strictEqual(updates.releaseEmbed({ bot: '1', panel: '1', botChanges: [], panelChanges: [] }).toJSON().description, 'Мелкие исправления.');
  });

  await test('after a restart the bot posts once per release, only where a channel is set', async () => {
    const top = updates.latest();
    await db.GuildSettings.create({ guildId: G, updatesChannelId: CH, updatesLastPosted: updates.releases()[1]?.id || null });
    await db.GuildSettings.create({ guildId: G2 }); // no channel
    const sent = [];
    const channel = { send: async (p) => sent.push(p) };
    const client = { guilds: { cache: new Map([[G, { channels: { cache: new Map([[CH, channel]]), fetch: async () => null } }], [G2, { channels: { cache: new Map() } }]]) } };
    assert.strictEqual(await updates.announceUpdates(client), 1);
    assert(sent.length === 1 && sent[0].embeds[sent[0].embeds.length - 1].toJSON().title.includes(`v${top.bot}`), 'the newest is last');
    assert.strictEqual((await db.GuildSettings.findByPk(G)).updatesLastPosted, top.id);
    assert.strictEqual(await updates.announceUpdates(client), 0, 'not twice');
    assert.strictEqual(sent.length, 1);
  });

  await test('the beta build does not post notes by itself (they go out when the version reaches main)', async () => {
    await db.GuildSettings.update({ updatesLastPosted: null }, { where: { guildId: G } });
    process.env.BOT_CHANNEL = 'beta'; require('../bot/utils/channel').resetChannel();
    const sent = []; const channel = { send: async (p) => sent.push(p) };
    const client = { guilds: { cache: new Map([[G, { channels: { cache: new Map([[CH, channel]]) } }]]) } };
    const n = await updates.announceUpdates(client);
    process.env.BOT_CHANNEL = 'release'; require('../bot/utils/channel').resetChannel();
    assert(n === 0 && sent.length === 0);
  });
  await test('a channel that is gone does not break anything and is retried later', async () => {
    await db.GuildSettings.update({ updatesLastPosted: null }, { where: { guildId: G } });
    const client = { guilds: { cache: new Map([[G, { channels: { cache: new Map(), fetch: async () => null } }]]) } };
    assert.strictEqual(await updates.announceUpdates(client), 0);
    assert.strictEqual((await db.GuildSettings.findByPk(G)).updatesLastPosted, null, 'still to be posted');
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((q, r, n) => { q.user = { id: '1', username: 'x' }; r.locals.user = q.user; n(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));

  await test('panel: the page lists every release with both versions and the "сейчас" mark', async () => {
    const html = await (await fetch(base + '/changelog')).text();
    for (const r of updates.releases()) assert(html.includes(`Бот <b>v${r.bot}</b>`) && html.includes(`Панель <b>v${r.panel}</b>`), r.id);
    assert(html.includes('сейчас') && html.includes('Новости об обновлениях') && html.includes('#новости') && !html.includes('#голос'));
  });

  await test('panel: choosing a channel starts from the current release; a voice or foreign channel is refused', async () => {
    await db.GuildSettings.update({ updatesChannelId: null, updatesLastPosted: null }, { where: { guildId: G } });
    assert((await post('/changelog/channel', { updatesChannelId: VOICE })).includes('badchannel'));
    assert((await post('/changelog/channel', { updatesChannelId: '899999999999999999' })).includes('badchannel'));
    assert((await post('/changelog/channel', { updatesChannelId: CH })).includes('saved'));
    const s = await db.GuildSettings.findByPk(G);
    assert(s.updatesChannelId === CH && s.updatesLastPosted === updates.latest().id, 'no backlog');
    await post('/changelog/channel', { updatesChannelId: '' });
    assert.strictEqual((await db.GuildSettings.findByPk(G)).updatesChannelId, null, 'switched off');
  });

  await test('panel: "Отправить в канал" posts the newest notes; Discord refusing gives a code, not raw text', async () => {
    await post('/changelog/channel', { updatesChannelId: CH });
    assert((await post('/changelog/send', {})).includes('notesent'));
    assert(posted[0][0] === `/channels/${CH}/messages` && posted[0][1].embeds[0].title.includes(updates.latest().bot) && posted[0][1].allowed_mentions.parse.length === 0);
    failWith = Object.assign(new Error('Missing Permissions'), { response: { status: 403, data: { code: 50013 } } });
    const loc = await post('/changelog/send', {}); failWith = null;
    assert(loc.includes('whfail=1') && loc.includes('reason=panelperm'), loc);
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
