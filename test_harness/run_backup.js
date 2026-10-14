// A server's data survives the bot being removed for 14 days: marking, restoring, purging, the picker note.
process.env.DATABASE_PATH = './data/test_backup.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const X = '300000000000000001', Y = '300000000000000002', Z = '300000000000000003', P = '300000000000000004';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => { q.user = { id: 'U', guilds: [{ id: P, name: 'Пропавший', permissions: '32' }, { id: Y, name: 'Живой', permissions: '32' }] }; n(); } });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuilds: async () => new Map([[Y, { id: Y, name: 'Живой', icon: null }]]), getBotGuildIds: async () => new Set([Y]), getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const axios = require('axios'); axios.create = () => ({ get: async () => { throw new Error('offline'); } });
const express = require('express');
(async () => {
  const db = require('../db'); await db.init();
  const B = require('../bot/modules/guildBackup');
  const life = require('../bot/events/guildLifecycle');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const DAY = 86400000;
  const fill = async (g) => {
    await db.GuildSettings.findOrCreate({ where: { guildId: g }, defaults: { welcomeMessage: 'привет ' + g } });
    await db.MemberProfile.create({ guildId: g, userId: '1', xp: 500 });
    await db.Warning.create({ guildId: g, userId: '1', moderatorId: '2', reason: 'r' });
    await db.ModLog.create({ guildId: g, userId: '1', moderatorId: '2', action: 'warn', reason: 'r' });
    await db.LevelRole.create({ guildId: g, level: 5, roleId: 'R', track: 'total' });
    await db.CustomCommand.create({ guildId: g, trigger: 'hi', response: 'yo', createdBy: '1' });
    await db.TempVoiceChannel.create({ guildId: g, channelId: 'c' + g, ownerId: '1' });
  };
  const count = async (g) => { let n = 0; for (const m of Object.values(db.sequelize.models)) if (m.rawAttributes.guildId) n += await m.count({ where: { guildId: g } }); return n; };
  const client = (ids) => ({ guilds: { cache: new Map(ids.map((i) => [i, { id: i }])) } });
  const evt = (name) => life.find((e) => e.name === name).execute;
  for (const g of [X, Y, Z]) await fill(g);
  const left = (g) => db.GuildSettings.findOne({ where: { guildId: g } }).then((s) => s.leftAt);

  await test('removing the bot only marks the server; all data stays', async () => {
    const before = await count(X);
    await evt('guildDelete')({ id: X, available: true });
    assert((await left(X)) instanceof Date && (await count(X)) === before && before >= 7, 'marked, kept ' + before);
    const first = await left(X); await evt('guildDelete')({ id: X }); assert(+(await left(X)) === +first, 'first moment kept');
  });
  await test('a Discord outage (unavailable guild) is not a removal', async () => {
    await evt('guildDelete')({ id: Y, available: false }); assert((await left(Y)) === null, 'not marked');
  });
  await test('re-adding within 14 days restores everything; the dead log webhook is forgotten, the forum and posts are kept', async () => {
    await db.GuildSettings.update({ logForumChannelId: 'F', logWebhookId: 'W', logWebhookToken: 't', logThreads: '{"files":"T"}' }, { where: { guildId: X } });
    await evt('guildCreate')({ id: X });
    const s = await db.GuildSettings.findOne({ where: { guildId: X } });
    assert(s.leftAt === null && s.welcomeMessage === 'привет ' + X && s.logForumChannelId === 'F' && s.logThreads === '{"files":"T"}' && s.logWebhookId === null, 'restored');
    assert((await db.MemberProfile.findOne({ where: { guildId: X } })).xp == 500, 'levels kept');
    assert(!(await B.restore(X)), 'restoring a normal server does nothing');
  });
  await test('purge: only servers gone for more than 14 days are deleted, in every table; recent and present ones stay', async () => {
    await B.markLeft(X); await B.markLeft(Z);
    await db.GuildSettings.update({ leftAt: new Date(Date.now() - 15 * DAY) }, { where: { guildId: X } });
    await db.GuildSettings.update({ leftAt: new Date(Date.now() - 13 * DAY) }, { where: { guildId: Z } });
    const purged = await B.purgeExpired(client([Y]));
    assert(purged.join() === X, 'purged ' + purged);
    assert((await count(X)) === 0 && (await count(Z)) >= 7 && (await count(Y)) >= 7, `X=${await count(X)} Z=${await count(Z)} Y=${await count(Y)}`);
  });
  await test('a server that is back is never purged, even if marked long ago', async () => {
    await db.GuildSettings.update({ leftAt: new Date(Date.now() - 30 * DAY) }, { where: { guildId: Z } });
    const purged = await B.purgeExpired(client([Y, Z]));
    assert(!purged.length && (await count(Z)) >= 7 && (await left(Z)) === null, 'kept and cleared');
  });
  await test('start-up check: a server removed while the bot was offline gets marked; one re-invited meanwhile is restored', async () => {
    const marked = await B.reconcile(client([Y])); // Z is not in the list any more
    assert(marked === 1 && (await left(Z)) instanceof Date && (await left(Y)) === null, 'marked Z');
    await B.reconcile(client([Y, Z])); assert((await left(Z)) === null, 'restored Z');
  });
  await test('the server picker tells how many days the saved data is kept', async () => {
    await db.GuildSettings.findOrCreate({ where: { guildId: P } });
    await B.markLeft(P); await db.GuildSettings.update({ leftAt: new Date(Date.now() - 4 * DAY) }, { where: { guildId: P } });
    const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use('/dashboard', require('../web/routes/dashboard')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
    const server = app.listen(0); const html = await (await fetch(`http://127.0.0.1:${server.address().port}/dashboard`)).text(); server.close();
    assert(html.includes('Пропавший') && html.includes('настройки сохранены ещё на 10 дн.'), html.slice(html.indexOf('Пропавший') - 50, html.indexOf('Пропавший') + 300));
  });
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
