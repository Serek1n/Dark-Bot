// What the bot listing review found: /profile of someone not on the server, /play in a voice channel the bot cannot use,
// coins taken from the bot itself, shop roles without "Manage Roles", log channels the bot cannot see.
process.env.DATABASE_PATH = './data/test_review.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-review-0123456789';
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '111111111111111111';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const G = '777000000000000001', BOT = process.env.DISCORD_CLIENT_ID, MEMBER = '555000000000000001', STRANGER = '555000000000000009', OTHERBOT = '555000000000000002';
const LOGS = '880000000000000001', OPEN = '880000000000000002', ROLE = '223456789012345678', MODS = '223456789012345679';

// Discord REST for the panel: the bot's role may or may not manage roles; #logs hides itself from @everyone.
let botPerms = P.ManageRoles | P.ViewChannel | P.SendMessages | P.EmbedLinks;
const rest = async (url) => {
  const roles = [{ id: G, position: 0, permissions: String(P.ViewChannel | P.SendMessages | P.EmbedLinks) }, { id: 'BOTROLE', position: 99, permissions: String(botPerms) }, { id: ROLE, position: 1, permissions: '0', managed: false }, { id: MODS, position: 2, permissions: '0' }];
  if (url === `/guilds/${G}`) return { data: { id: G, owner_id: 'OWNER', roles } };
  if (url === `/guilds/${G}/channels`) return { data: [
    { id: LOGS, type: 0, name: 'logs', permission_overwrites: [{ id: G, type: 0, allow: '0', deny: String(P.ViewChannel) }, { id: MODS, type: 0, allow: String(P.ViewChannel), deny: '0' }] },
    { id: OPEN, type: 0, name: 'open', permission_overwrites: [] }
  ] };
  const m = /^\/guilds\/\d+\/members\/(\d+|OWNER)$/.exec(url);
  if (m) {
    if (m[1] === 'OWNER') return { data: { roles: [], user: { id: 'OWNER' } } };
    if (m[1] === BOT) return { data: { roles: ['BOTROLE'], user: { id: BOT, bot: true } } };
    if (m[1] === OTHERBOT) return { data: { roles: [], user: { id: OTHERBOT, bot: true } } };
    if (m[1] === MEMBER) return { data: { roles: [], user: { id: MEMBER } } };
    const e = new Error('Unknown Member'); e.response = { status: 404 }; throw e;
  }
  return { data: {} };
};
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.guildAccess = { owner: true }; n(); } });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getUsers: async () => ({}),
  getGuildRoles: async () => [{ id: ROLE, name: 'VIP', position: 1 }, { id: MODS, name: 'Mods', position: 2 }],
  getGuildChannels: async () => [{ id: LOGS, name: 'logs', type: 0 }, { id: OPEN, name: 'open', type: 0 }], getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: { get: rest, put: async () => ({}), delete: async () => ({}) }
});

const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  const db = require('../db'); await db.init();
  const embeds = require('../bot/utils/embeds');
  void embeds;

  // ---- 1. /profile and friends ----
  const { refuseTarget } = require('../bot/utils/memberGate');
  const guild = { id: G, members: { cache: new Map([[MEMBER, { id: MEMBER }]]), fetch: async (id) => { if (id === MEMBER) return { id }; throw new Error('Unknown Member'); } } };
  const inter = { user: { id: 'ME' }, guild };
  await test('/profile, /level, /economy pay: only people on this server, never bots', async () => {
    assert.strictEqual(await refuseTarget(inter, { id: MEMBER }), null);
    assert.strictEqual(await refuseTarget(inter, { id: 'ME' }), null, 'yourself');
    assert.strictEqual(await refuseTarget(inter, { id: STRANGER }), 'Этого пользователя нет на сервере.');
    assert(/ботов/.test(await refuseTarget(inter, { id: BOT, bot: true })));
  });
  await test('/profile of someone not on the server answers with an error and makes no profile', async () => {
    const profile = require('../bot/commands/leveling/profile');
    const replies = [];
    const i = { ...inter, options: { getSubcommand: () => 'view', getUser: () => ({ id: STRANGER, username: 'x' }), getString: () => null, getInteger: () => null }, reply: async (r) => replies.push(r), deferReply: async () => {}, editReply: async (r) => replies.push(r) };
    await profile.execute(i);
    assert(JSON.stringify(replies).includes('нет на сервере'), JSON.stringify(replies).slice(0, 200));
    assert.strictEqual(await db.MemberProfile.count({ where: { userId: STRANGER } }), 0, 'not added to the top');
  });

  // ---- 2. /play ----
  await test('/play explains what the bot lacks in the voice channel instead of hanging; a full channel too', async () => {
    const { musicRefusal } = require('../bot/commands/music/music');
    const me = { id: BOT };
    const channel = (have, extra = {}) => ({ name: 'Музыка', userLimit: 0, members: new Map(), permissionsFor: () => new PermissionsBitField(have), ...extra });
    assert.strictEqual(musicRefusal(channel(P.ViewChannel | P.Connect | P.Speak), me), null);
    const text = musicRefusal(channel(P.ViewChannel), me);
    assert(/«Подключаться», «Говорить»/.test(text) && /Музыка/.test(text), text);
    const full = musicRefusal(channel(P.ViewChannel | P.Connect | P.Speak, { userLimit: 2, members: new Map([['a', {}], ['b', {}]]) }), me);
    assert(/заполнен/.test(full), full);
    assert.strictEqual(musicRefusal(channel(P.ViewChannel | P.Connect | P.Speak | P.MoveMembers, { userLimit: 2, members: new Map([['a', {}], ['b', {}]]) }), me), null, 'Move Members lets the bot in');
    assert(fs.readFileSync(path.join(__dirname, '..', 'bot', 'commands', 'music', 'music.js'), 'utf8').indexOf('musicRefusal(voiceChannel') < fs.readFileSync(path.join(__dirname, '..', 'bot', 'commands', 'music', 'music.js'), 'utf8').indexOf('await interaction.deferReply();'), 'checked before anything else');
  });

  // ---- panel ----
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.locals.termText = require('../bot/utils/duration').formatTerm;
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || '');

  // ---- 3. coins and levels for the bot / strangers ----
  await test('panel: coins and levels cannot be changed for the bot, another bot or someone not on the server', async () => {
    assert((await post('/economy/grant', { userId: BOT, amount: '-100' })).includes('isbot'));
    assert((await post('/economy/grant', { userId: OTHERBOT, amount: '100' })).includes('isbot'));
    assert((await post('/economy/grant', { userId: STRANGER, amount: '100' })).includes('notmember'));
    assert((await post('/leveling/adjust', { userId: BOT, mode: 'add', amount: '3' })).includes('isbot'));
    assert.strictEqual(await db.MemberProfile.count({ where: { userId: [BOT, OTHERBOT, STRANGER] } }), 0, 'nobody of them is in the top');
    assert((await post('/economy/grant', { userId: MEMBER, amount: '100' })).includes('granted'));
    assert.strictEqual((await db.MemberProfile.findOne({ where: { guildId: G, userId: MEMBER } })).balance, 100);
  });
  await test('on start the bot removes profiles of bots made earlier', async () => {
    assert(fs.readFileSync(path.join(__dirname, '..', 'bot', 'events', 'ready.js'), 'utf8').includes('MemberProfile.destroy({ where: { userId: [...botIds] } })'));
  });

  // ---- 4. roles without "Manage Roles" ----
  await test('shop and other role pickers: without "Manage Roles" every role is refused with that reason', async () => {
    const { roleGuard } = require('../web/utils/roles');
    assert.strictEqual((await roleGuard(G, 'OWNER')).check(ROLE), null, 'with the right');
    botPerms = P.ViewChannel | P.SendMessages | P.EmbedLinks;
    try {
      assert.strictEqual((await roleGuard(G, 'OWNER')).check(ROLE), 'у бота нет права «Управлять ролями»');
      const loc = await post('/shop/items', { name: 'VIP', price: '10', currency: 'coins', type: 'role', roleId: ROLE, enabled: 'on' });
      assert(loc.includes('rolenotallowed'), loc);
      assert.strictEqual(await db.ShopItem.count({ where: { guildId: G } }), 0, 'not added');
      const page = await (await fetch(base + '/shop')).text();
      assert(page.includes('@VIP — у бота нет права «Управлять ролями»'), 'the reason is next to the role');
    } finally { botPerms = P.ManageRoles | P.ViewChannel | P.SendMessages | P.EmbedLinks; }
  });

  // ---- 5. channels the bot cannot use ----
  await test('mod log, level-ups, greetings…: a channel the bot cannot see is not saved, the page names the missing rights', async () => {
    let loc = await post('/moderation', { modLogChannelId: LOGS, reportChannelId: OPEN, reportDailyLimit: '5' });
    assert(loc.includes('noperm=1') && decodeURIComponent(loc).endsWith('need=view'), loc);
    let s = await db.GuildSettings.findByPk(G);
    assert(s.modLogChannelId !== LOGS && s.reportChannelId === OPEN, 'the good channel is saved, the bad one is not');
    loc = await post('/leveling', { levelUpChannelId: LOGS });
    assert(loc.includes('noperm=1'), loc);
    loc = await post('/welcome', { welcomeChannelId: LOGS, welcomeMessage: 'hi' });
    assert(loc.includes('noperm=1'), loc);
    loc = await post('/shop/settings', { shopLogChannelId: LOGS });
    assert(loc.includes('noperm=1'), loc);
    loc = await post('/moderation', { modLogChannelId: '880000000000000077' });
    assert(decodeURIComponent(loc).includes('need=gone'), 'a deleted channel');
    // the bot's role is let into #logs by its overwrite → fine
    botPerms = P.ManageRoles | P.ViewChannel | P.SendMessages | P.EmbedLinks;
    const { permsFromRest } = require('../web/utils/channels');
    const viaRole = permsFromRest(G, { roles: [{ id: G, permissions: String(P.ViewChannel | P.SendMessages | P.EmbedLinks) }, { id: MODS, permissions: '0' }] }, { roles: [MODS], user: { id: BOT } }, { permission_overwrites: [{ id: G, type: 0, allow: '0', deny: String(P.ViewChannel) }, { id: MODS, type: 0, allow: String(P.ViewChannel), deny: '0' }] });
    assert(viaRole & P.ViewChannel, 'a role overwrite allows it again');
    const viaMember = permsFromRest(G, { roles: [{ id: G, permissions: String(P.ViewChannel) }] }, { roles: [], user: { id: BOT } }, { permission_overwrites: [{ id: BOT, type: 1, allow: '0', deny: String(P.SendMessages | P.ViewChannel) }] });
    assert(!(viaMember & P.ViewChannel), 'a member overwrite denies');
    s = await db.GuildSettings.findByPk(G);
    loc = await post('/moderation', { modLogChannelId: s.reportChannelId, reportChannelId: s.reportChannelId });
    assert(loc.includes('saved=1'), loc);
    const toasts = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', 'panel.js'), 'utf8'); // the toasts of every page
    assert(toasts.includes("noperm: [needText(params.get('need')), true]") && toasts.includes('не хватает прав'), 'the message on the page');
  });

  await test('logs: "what not to log" keeps only this server\'s channels and roles; the bot skips them', async () => {
    const loc = await post('/logs', [['logIgnoreBots', 'on'], ['logIgnoreChannels', OPEN], ['logIgnoreChannels', '880000000000000077'], ['logIgnoreRoles', MODS], ['logIgnoreRoles', G], ['logIgnoreRoles', '999']]);
    assert(loc.includes('saved=1'), loc);
    const st = await db.GuildSettings.findByPk(G);
    assert(st.logIgnoreBots && st.logIgnoreChannels === JSON.stringify([OPEN]) && st.logIgnoreRoles === JSON.stringify([MODS]), JSON.stringify({ b: st.logIgnoreBots, c: st.logIgnoreChannels, r: st.logIgnoreRoles }));
    const L = require('../bot/modules/serverLog');
    const cfg = { ignoreChannels: new Set([OPEN]), ignoreRoles: new Set([MODS]), ignoreBots: true };
    const member = (ids) => ({ roles: { cache: new Map(ids.map((id) => [id, { id }])) } });
    assert(L.skipped(cfg, { channelId: OPEN }) && L.skipped(cfg, { channel: { id: 'thread', parentId: OPEN } }), 'a channel and its threads');
    assert(L.skipped(cfg, { channelId: LOGS, isBot: true }) && L.skipped(cfg, { channelId: LOGS, member: member([MODS]) }), 'bots and roles');
    assert(!L.skipped(cfg, { channelId: LOGS, member: member([ROLE]) }) && !L.skipped(null, { channelId: OPEN }), 'everything else is logged');
    const page = await (await fetch(base + '/logs')).text();
    assert(page.includes('Что не записывать') && page.includes('видов событий записывается') && page.includes('Не записывать сообщения ботов и вебхуков'), 'the page');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
