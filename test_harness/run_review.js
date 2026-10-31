// Fixes from the full review: level loop limits, role guard in the panel, foreign channels refused, limits, error texts,
// stale voice sessions, poll counting, shop stock reservation, guild-only commands.
process.env.DATABASE_PATH = './data/test_review.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

const G = '777000000000000001', OTHER_FORUM = '900000000000000099', TEXT = '800000000000000001', FOREIGN = '800000000000000099';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
const botCalls = [];
const roleList = [{ id: '123456789012345671', name: 'admin', position: 3 }, { id: '123456789012345672', name: 'ok', position: 2 }];
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(),
  getGuildChannels: async () => [{ id: TEXT, name: 'general', type: 0 }, { id: '800000000000000002', name: 'news', type: 5 }, { id: '900000000000000001', name: 'logs', type: 15 }],
  getGuildRoles: async () => roleList,
  getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}),
  botApi: { get: async (u) => { botCalls.push(['GET', u]); return { data: {} }; }, post: async (u) => { botCalls.push(['POST', u]); return { data: {} }; }, patch: async (u) => { botCalls.push(['PATCH', u]); return { data: {} }; }, put: async () => ({}), delete: async () => ({}) }
});

const results = []; let failed = 0;
async function test(name, fn) {
  try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
}

(async () => {
  const db = require('../db'); await db.init();
  const leveling = require('../bot/modules/leveling');

  await test('levelFromXp never loops forever: Infinity, 1e400 and NaN give a bounded level', async () => {
    assert.strictEqual(leveling.levelFromXp(Infinity), 1000);
    assert.strictEqual(leveling.levelFromXp(Number('1e400')), 1000);
    assert.strictEqual(leveling.levelFromXp(NaN), 0);
    assert.strictEqual(leveling.levelFromXp(1000), 4);
  });

  await test('import: absurd numbers from a file are clamped, the import finishes', async () => {
    const { importLacuna } = require('../bot/modules/importLevels');
    const t0 = Date.now();
    const r = await importLacuna(G, [{ _id: '555000000000000001', activities: { levels: [{ guild_id: G, experience: { level: 3, current: 1e300 }, activity: { total_messages: 1e30 } }], wallets: [{ guild_id: G, currencies: [{ id: 'DEFAULT', amount: 'Infinity' }] }] }, dark: { chatXp: Number('1e400'), voiceXp: -5, crystals: 'abc' } }]);
    assert(r.imported === 1 && Date.now() - t0 < 5000, 'finished');
    const p = await db.MemberProfile.findOne({ where: { guildId: G, userId: '555000000000000001' } });
    assert(Number.isFinite(Number(p.xp)) && Number(p.xp) <= leveling.totalXpForLevel(500) && Number(p.voiceXp) === 0 && Number(p.crystals) === 0, JSON.stringify(p.toJSON()));
    assert(Number(p.balance) <= 1e12 && Number(p.messageCount) <= 1e9 && p.level <= 1000);
  });

  // ---- role guard with a fake bot client ----
  const { setClient } = require('../web/botBridge');
  const { PermissionFlagsBits: P } = require('discord.js');
  const role = (id, position, extra = {}) => ({ id, position, managed: false, permissions: { bitfield: 0n }, ...extra });
  const roles = new Map([
    [G, role(G, 0)], ['R_OK', role('R_OK', 2)], ['R_MANAGED', role('R_MANAGED', 2, { managed: true })], ['R_HIGH', role('R_HIGH', 9)],
    ['R_MINE', role('R_MINE', 5)], ['R_ADMIN', role('R_ADMIN', 3, { permissions: { bitfield: P.Administrator } })], ['R_BAN', role('R_BAN', 3, { permissions: { bitfield: P.BanMembers } })],
    ['R_MUTE', role('R_MUTE', 3, { permissions: { bitfield: P.ModerateMembers | P.ManageMessages } })]
  ]);
  const members = { MOD: { permissions: { has: () => false }, roles: { highest: { position: 5 } } }, ADMIN: { permissions: { has: (p) => p === P.Administrator }, roles: { highest: { position: 8 } } } };
  const guild = { id: G, ownerId: 'OWNER', roles: { cache: roles }, members: { me: { roles: { highest: { position: 8 } } }, fetch: async (id) => { if (!members[id]) throw new Error('unknown'); return members[id]; } } };
  setClient({ isReady: () => true, guilds: { cache: new Map([[G, guild]]) } });
  const { roleGuard } = require('../web/utils/roles');

  await test('role guard: a moderator cannot hand out managed, too high, his own level or admin/ban roles', async () => {
    const g = await roleGuard(G, 'MOD');
    assert.strictEqual(g.check('R_OK'), null);
    assert(g.check('R_MANAGED') && g.check('R_HIGH') && g.check('R_MINE') && g.check('R_ADMIN') && g.check('R_BAN') && g.check(G) && g.check('NOPE'));
    const a = g.annotate([{ id: 'R_OK' }, { id: 'R_ADMIN' }]); assert(!a[0].blocked && a[1].blocked);
  });
  await test('role guard: an administrator may give moderation roles below his own; roles that run the server — nobody', async () => {
    const a = await roleGuard(G, 'ADMIN'); assert(a.check('R_MUTE') === null && a.check('R_MINE') === null && a.check('R_HIGH'));
    assert(/управление сервером/.test(a.check('R_ADMIN')) && /управление сервером/.test(a.check('R_BAN')), 'admin/ban roles are never self-service');
    const o = await roleGuard(G, 'OWNER'); assert(o.check('R_MUTE') === null && o.check('R_OK') === null && o.check('R_ADMIN') && o.check('R_HIGH') && o.check('R_MANAGED'));
  });

  // ---- panel routes ----
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  let who = 'MOD';
  app.use((q, r, n) => { q.user = { id: who, username: 'x' }; r.locals.user = q.user; n(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));

  await test('panel: reaction role, level role and shop refuse a role the user may not hand out', async () => {
    assert((await post('/level-roles', { level: '5', roleId: '123456789012345678' })).includes('invalid'), 'unknown role');
    roles.set('123456789012345671', role('123456789012345671', 3, { permissions: { bitfield: P.Administrator } }));
    roles.set('123456789012345672', role('123456789012345672', 2));
    assert((await post('/level-roles', { level: '5', roleId: '123456789012345671' })).includes('rolenotallowed'), 'admin role refused');
    assert((await post('/level-roles', { level: '5', roleId: '123456789012345672' })).includes('saved'), 'ordinary role ok');
    assert((await post('/shop/items', { name: 'A', type: 'role', roleId: '123456789012345671', price: '5', enabled: 'on' })).includes('rolenotallowed'), 'shop');
    assert((await post('/welcome', { autoRoleId: '123456789012345671' })).includes('rolenotallowed'), 'autorole');
    who = 'OWNER'; assert((await post('/welcome', { autoRoleId: '123456789012345671' })).includes('rolenotallowed'), 'not even the owner: an admin role for every newcomer');
    assert((await post('/welcome', { autoRoleId: '123456789012345672' })).includes('saved'), 'the owner may set an ordinary role'); who = 'MOD';
    assert((await post('/welcome', { autoRoleId: '123456789012345672' })).includes('saved'), 'an unchanged autorole stays');
    const page = await (await fetch(base + '/level-roles')).text();
    assert(/<option value="123456789012345671" disabled>@admin — /.test(page), 'blocked role shown disabled with the reason');
  });

  await test('logs: a forum of another server is refused without touching it', async () => {
    botCalls.length = 0;
    assert((await post('/logs', { logForumChannelId: OTHER_FORUM, action: 'setup' })).includes('lognoforum'));
    assert(!botCalls.some(([, u]) => u.includes(OTHER_FORUM)), JSON.stringify(botCalls));
  });

  await test('alerts: foreign channel and bad Twitch login refused, news channels allowed, 25 per server', async () => {
    assert((await post('/alerts', { platform: 'twitch', targetId: 'good_login', channelId: FOREIGN })).includes('badchannel'));
    assert((await post('/alerts', { platform: 'twitch', targetId: 'bad/login x', channelId: TEXT })).includes('badlogin'));
    assert((await post('/alerts', { platform: 'twitch', targetId: 'streamer', channelId: '800000000000000002' })).includes('saved'), 'news channel');
    for (let i = 0; i < 24; i++) await db.Alert.create({ guildId: G, platform: 'twitch', targetId: 'user' + i, channelId: TEXT });
    assert((await post('/alerts', { platform: 'twitch', targetId: 'one_more', channelId: TEXT })).includes('toomany'), 'limit');
    assert((await post('/alerts', { platform: 'twitch', targetId: 'streamer', channelId: TEXT })).includes('saved'), 'editing an existing one is fine');
  });

  await test('custom commands: at most 100 per server, an existing one can still be edited', async () => {
    await db.CustomCommand.bulkCreate(Array.from({ length: 100 }, (_, i) => ({ guildId: G, trigger: 'c' + i, response: 'r', createdBy: 'X' })));
    assert((await post('/custom-commands', { trigger: 'new', response: 'x' })).includes('toomany'));
    assert((await post('/custom-commands', { trigger: 'c5', response: 'changed' })).includes('saved'));
  });

  await test('errors travel as codes and are shown in Russian; raw Discord text never', async () => {
    const { errorKey, errorText } = require('../bot/utils/discordErrors');
    assert.strictEqual(errorKey({ response: { status: 400, data: { code: 50035, message: 'Invalid Form Body' } } }), 'form');
    assert.strictEqual(errorKey({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }), 'timeout');
    assert.strictEqual(errorKey({ rawError: { code: 50013 }, message: 'Missing Permissions' }), 'perm');
    const t = errorText(new Error('Something English')); assert(!/Something/.test(t) && /Discord/.test(t));
    assert.strictEqual(require('../bot/modules/webhookPanel').explain(new Error('Unknown thing')), t);
    const sidebar = fs.readFileSync(path.join(__dirname, '..', 'web', 'views', 'partials', 'sidebar.ejs'), 'utf8');
    assert(!sidebar.includes("params.get('msg')"), 'no text from the link');
  });

  await test('voice time: a session of someone no longer in voice is closed on flush', async () => {
    const vt = require('../bot/modules/voiceTime');
    vt.sessions.set(`${G}:A`, Date.now() - 60_000); vt.sessions.set(`${G}:B`, Date.now() - 60_000); vt.sessions.set('999:C', Date.now() - 60_000);
    const client = { guilds: { cache: new Map([[G, { voiceStates: { cache: new Map([['A', { channelId: '1' }]]) } }]]) } };
    await vt.flushAll(client);
    assert(vt.sessions.has(`${G}:A`) && !vt.sessions.has(`${G}:B`) && !vt.sessions.has('999:C'));
    const b = await db.MemberProfile.findOne({ where: { guildId: G, userId: 'B' } }); assert(Number(b.voiceSeconds) >= 59, 'its last window is still counted');
  });

  await test('polls: votes are counted from the message over REST (the reaction cache is off)', async () => {
    const polls = require('../bot/modules/polls');
    const poll = await db.Poll.create({ guildId: G, channelId: 'C9', messageId: 'M9', question: 'Q', options: JSON.stringify([{ emoji: '1️⃣', label: 'a' }, { emoji: '2️⃣', label: 'b' }]), endsAt: new Date(Date.now() - 1000) });
    const replies = [];
    const message = { reactions: { cache: new Map() }, edit: async () => {}, reply: async (x) => replies.push(x) };
    const client = { channels: { fetch: async () => ({ messages: { fetch: async () => message }, send: async () => {} }) }, rest: { get: async () => ({ reactions: [{ emoji: { id: null, name: '1️⃣' }, count: 4, me: true }, { emoji: { id: null, name: '2️⃣' }, count: 2, me: true }] }) } };
    await polls.tick(client);
    const text = replies[0].embeds[0].toJSON().description;
    assert(/Всего голосов: \*\*4\*\*/.test(text) && text.includes('3 (75%)'), text);
    await poll.reload(); assert(poll.ended);
  });

  await test('shop: the last piece is reserved before the money; a sold-out item takes nothing', async () => {
    const shop = require('../bot/modules/shop');
    const settings = await leveling.getOrCreateSettings(G); settings.shopEnabled = true; await settings.save();
    const item = await db.ShopItem.create({ guildId: G, name: 'Last', type: 'item', price: 10, currency: 'coins', enabled: true, stock: 1 });
    await db.MemberProfile.create({ guildId: G, userId: 'BUYER', balance: 100 });
    const member = { id: 'BUYER', roles: { cache: new Map() } };
    const g = { id: G, roles: { cache: new Map() } };
    const r1 = await shop.purchaseItem({ guild: g, member, itemId: item.id }); assert(r1.ok, JSON.stringify(r1));
    await item.update({ stock: 0 });
    const r2 = await shop.purchaseItem({ guild: g, member, itemId: item.id }); assert(!r2.ok);
    const p = await db.MemberProfile.findOne({ where: { guildId: G, userId: 'BUYER' } }); assert.strictEqual(Number(p.balance), 90);
  });

  await test('commands opened in DMs answer with a note instead of failing', async () => {
    const handler = require('../bot/events/interactionCreate');
    const out = [];
    let ran = false;
    const i = { isChatInputCommand: () => true, isContextMenuCommand: () => false, inGuild: () => false, commandName: 'balance', client: { commands: new Map([['balance', { execute: async () => { ran = true; } }]]) }, reply: async (p) => out.push(p) };
    await handler.execute(i);
    assert(!ran && out[0].embeds[0].toJSON().description.includes('только на сервере'));
  });

  server.close();
  console.log(results.join('\n'));
  console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
