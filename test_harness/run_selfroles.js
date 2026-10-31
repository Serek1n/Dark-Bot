// Roles the bot gives by itself are checked at the moment of giving; @everyone and role pings are off by default;
// reaction roles cost no query on ordinary messages; roles on a term are listed in the panel and can be taken off early.
process.env.DATABASE_PATH = './data/test_selfroles.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits: P } = require('discord.js');
const G = '777000000000000001', R1 = '600000000000000001', R2 = '600000000000000002';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const deleted = []; let deleteFails = null;
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getGuildChannels: async () => [],
  getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'Покупатель ' + id.slice(-2) }])),
  getGuildRoles: async () => [{ id: R1, name: 'VPN Trial', position: 1 }, { id: R2, name: 'Другая', position: 2 }],
  getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: {
    get: require('./ownerGuild').ownerGet(G, [R1, R2]),
    delete: async (u) => { if (deleteFails) { const e = new Error('x'); e.response = { status: deleteFails }; throw e; } deleted.push(u); return {}; },
    post: async () => ({ data: {} }), put: async () => ({})
  }
});
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  const db = require('../db'); await db.init();
  const safe = require('../bot/utils/safeRole');
  const role = (id, perms = 0n, extra = {}) => ({ id, editable: true, managed: false, name: id, permissions: { bitfield: perms }, ...extra });

  await test('self-service never gives roles that run the server; moderation-light roles and ordinary ones are fine', async () => {
    assert(!safe.canSelfGive(role('a', P.Administrator)) && !safe.canSelfGive(role('b', P.BanMembers)) && !safe.canSelfGive(role('c', P.ManageRoles)));
    assert(!safe.canSelfGive(role('d', 0n, { managed: true })) && !safe.canSelfGive(role('e', 0n, { editable: false })) && !safe.canSelfGive(null));
    assert(!safe.canSelfGive(role(G), { id: G }), '@everyone');
    assert(safe.canSelfGive(role('f')) && safe.canSelfGive(role('g', P.ManageMessages)), 'ordinary');
    assert(/управления сервером/.test(safe.selfGiveRefusal(role('a', P.Administrator))));
  });

  await test('a reaction role that later got Administrator is not given (removing still works)', async () => {
    const rr = require('../bot/modules/reactionRoles');
    await db.ReactionRole.create({ guildId: G, channelId: 'C', messageId: 'M1', emoji: '🛡', roleId: R1 });
    const roles = new Set(); const member = { roles: { cache: { has: (id) => roles.has(id) }, add: async (r) => roles.add(r.id), remove: async (r) => roles.delete(r.id) } };
    const guild = { id: G, roles: { cache: new Map([[R1, role(R1, P.Administrator)]]) }, members: { fetch: async () => member } };
    await rr.handleReactionRole({ message: { id: 'M1', guild }, emoji: { name: '🛡', id: null } }, { id: 'U' }, true);
    assert(!roles.has(R1), 'not given');
    roles.add(R1); await rr.handleReactionRole({ message: { id: 'M1', guild }, emoji: { name: '🛡', id: null } }, { id: 'U' }, false);
    assert(!roles.has(R1), 'taken away');
  });

  await test('reactions on messages without reaction roles do not touch the database', async () => {
    const rr = require('../bot/modules/reactionRoles');
    let queries = 0; const real = db.ReactionRole.findOne; db.ReactionRole.findOne = async (...a) => { queries++; return real.apply(db.ReactionRole, a); };
    try {
      await rr.handleReactionRole({ message: { id: 'OTHER', guild: {} }, emoji: { name: '👍' } }, { id: 'U' }, true);
      assert.strictEqual(queries, 0, 'no lookup');
      await db.ReactionRole.create({ guildId: G, channelId: 'C', messageId: 'M2', emoji: '👍', roleId: R2 });
      assert(await rr.hasLinks('M2'), 'a new link is seen at once');
    } finally { db.ReactionRole.findOne = real; }
  });

  await test('shop, voice roles, level roles, interactive messages and the autorole use the same check', async () => {
    const shop = require('../bot/modules/shop');
    await db.GuildSettings.findOrCreate({ where: { guildId: G } });
    const [p] = await db.MemberProfile.findOrCreate({ where: { guildId: G, userId: 'B' } }); await p.update({ balance: 1000 });
    const it = await db.ShopItem.create({ guildId: G, name: 'Админка', price: 10, type: 'role', roleId: R1 });
    const guild = { id: G, roles: { cache: { get: () => role(R1, P.Administrator) } }, channels: { cache: { get: () => null } } };
    const r = await shop.purchaseItem({ guild, member: { id: 'B', roles: { cache: { has: () => false }, add: async () => { throw new Error('must not be called'); } } }, itemId: it.id });
    assert(!r.ok && /управления сервером/.test(r.error), r.error);
    assert.strictEqual((await db.MemberProfile.findOne({ where: { guildId: G, userId: 'B' } })).balance, 1000, 'nothing charged');
    for (const f of ['bot/modules/voiceRoles.js', 'bot/modules/levelRoles.js', 'bot/modules/interactive.js', 'bot/events/guildMemberAdd.js']) {
      assert(/canSelfGive\(/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), f);
    }
  });

  await test('the bot pings only users unless a message says otherwise (track titles, nicknames, feeds cannot ping @everyone)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8');
    assert(/allowedMentions: \{ parse: \['users'\], repliedUser: true \}/.test(src));
  });

  await test('a bought term ends: the role goes and the buyer gets a DM; /temprole terms end quietly', async () => {
    const tr = require('../bot/modules/tempRoles');
    const dms = [];
    const mk = (id) => ({ id, roles: { cache: { has: () => true }, remove: async () => {} }, send: async (m) => dms.push([id, m.content]) });
    const members = { S: mk('S'), T: mk('T') };
    const client = { guilds: { cache: new Map([[G, { id: G, name: 'Сервер', roles: { cache: new Map([[R1, { name: 'VPN Trial' }]]) }, members: { fetch: async (id) => members[id] } }]]) } };
    await db.TempRole.create({ guildId: G, userId: 'S', roleId: R1, expiresAt: new Date(Date.now() - 1000), givenBy: 'shop:1' });
    await db.TempRole.create({ guildId: G, userId: 'T', roleId: R1, expiresAt: new Date(Date.now() - 1000), givenBy: 'MOD' });
    await tr.tick(client);
    assert(dms.length === 1 && dms[0][0] === 'S' && dms[0][1].includes('VPN Trial') && dms[0][1].includes('/shop'), JSON.stringify(dms));
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.locals.termText = require('../bot/utils/duration').formatTerm;
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p) => fetch(base + p, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));

  await test('panel: roles on a term are listed (shop item or /temprole), and can be taken off early', async () => {
    const item = await db.ShopItem.create({ guildId: G, name: 'NEXUS VPN', price: 5000, type: 'role', roleId: R1, durationSeconds: 864000 });
    const a = await db.TempRole.create({ guildId: G, userId: '500000000000000011', roleId: R1, expiresAt: new Date(Date.now() + 86400e3), givenBy: `shop:${item.id}` });
    await db.TempRole.create({ guildId: G, userId: '500000000000000012', roleId: R2, expiresAt: new Date(Date.now() + 2 * 86400e3), givenBy: 'MOD' });
    const page = await (await fetch(base + '/shop')).text();
    assert(page.includes('Роли на время') && page.includes('магазин: NEXUS VPN') && page.includes('@VPN Trial') && page.includes('/temprole') && page.includes('Покупатель 11'), 'listed');
    assert(page.indexOf('Покупатель 11') < page.indexOf('Покупатель 12'), 'the nearest end first');
    assert(page.includes('data-role-only') && page.includes('form="shopdel-'), 'role-only fields marked; delete button sits in the row');
    assert((await post(`/shop/terms/${a.id}/revoke`)).includes('revoked'));
    assert(deleted.includes(`/guilds/${G}/members/500000000000000011/roles/${R1}`) && !(await db.TempRole.findByPk(a.id)), 'taken off and forgotten');
  });

  await test('panel: taking off fails in Discord → the term stays; the member is gone (404) → just forgotten; other server → refused', async () => {
    const b = await db.TempRole.create({ guildId: G, userId: '500000000000000013', roleId: R1, expiresAt: new Date(Date.now() + 86400e3) });
    deleteFails = 403; assert((await post(`/shop/terms/${b.id}/revoke`)).includes('revokefail')); assert(await db.TempRole.findByPk(b.id));
    deleteFails = 404; assert((await post(`/shop/terms/${b.id}/revoke`)).includes('revoked')); assert(!(await db.TempRole.findByPk(b.id)));
    deleteFails = null;
    const other = await db.TempRole.create({ guildId: '777000000000000002', userId: '500000000000000014', roleId: R1, expiresAt: new Date(Date.now() + 86400e3) });
    assert((await post(`/shop/terms/${other.id}/revoke`)).includes('invalid')); assert(await db.TempRole.findByPk(other.id));
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
