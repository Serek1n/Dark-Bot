// Features taken from Polaris: role multipliers, the configurable level-up message, "keep" for level roles,
// /calc, the "Профиль" menu, /level and the public leaderboard.
process.env.DATABASE_PATH = './data/test_polaris.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

const G = '777000000000000001';
const R1 = '600000000000000001', R2 = '600000000000000002', MUTE = '600000000000000003';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(),
  getGuildChannels: async () => [{ id: '800000000000000001', name: 'general', type: 0 }],
  getGuildRoles: async () => [{ id: R1, name: 'Бустер', position: 3 }, { id: R2, name: 'VIP', position: 2 }, { id: MUTE, name: 'Мут', position: 1 }],
  getGuild: async (id) => ({ id, name: 'Тёмный клуб', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'u' + id.slice(-2), avatar: '' }])),
  botApi: { get: async () => ({ data: {} }), post: async () => ({ data: {} }), put: async () => ({}), delete: async () => ({}) }
});

const results = []; let failed = 0;
async function test(name, fn) {
  try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
}
const roleMember = (ids, positions = {}) => ({ roles: { cache: new Map(ids.map((id) => [id, { id, position: positions[id] ?? 1 }])) } });

(async () => {
  const db = require('../db'); await db.init();
  const leveling = require('../bot/modules/leveling');
  const boosts = require('../bot/modules/xpBoosts');

  await test('role multipliers: every way of combining roles', async () => {
    const s = (mode) => ({ roleBoosts: JSON.stringify({ [R1]: { xp: 1.5, coins: 1 }, [R2]: { xp: 2, coins: 3 } }), roleBoostMode: mode });
    const m = roleMember([R1, R2], { [R1]: 5, [R2]: 2 });
    assert.strictEqual(boosts.roleBoostFor(s('largest'), m).xp, 2);
    assert.strictEqual(boosts.roleBoostFor(s('smallest'), m).xp, 1.5);
    assert.strictEqual(boosts.roleBoostFor(s('highest'), m).xp, 1.5, 'R1 is the higher role');
    assert.strictEqual(boosts.roleBoostFor(s('add'), m).xp, 2.5);
    assert.strictEqual(boosts.roleBoostFor(s('multiply'), m).xp, 3);
    assert.strictEqual(boosts.roleBoostFor(s('largest'), roleMember([])).xp, 1, 'no boosted role = x1');
    assert.strictEqual(boosts.roleBoostFor(s('largest'), [R2]).coins, 3, 'a plain list of role ids works too');
  });

  await test('role and channel together; x0 always wins; never above x20', async () => {
    const st = (mode) => ({ roleBoosts: JSON.stringify({ [R1]: { xp: 1.5, coins: 1 }, [MUTE]: { xp: 0, coins: 0 } }), boostStacking: mode });
    const m = roleMember([R1]);
    assert.strictEqual(boosts.totalBoost(st('multiply'), { xp: 2, coins: 1 }, m).xp, 3);
    assert.strictEqual(boosts.totalBoost(st('add'), { xp: 2, coins: 1 }, m).xp, 2.5);
    assert.strictEqual(boosts.totalBoost(st('largest'), { xp: 2, coins: 1 }, m).xp, 2);
    assert.strictEqual(boosts.totalBoost(st('channel'), { xp: 2, coins: 1 }, m).xp, 2);
    assert.strictEqual(boosts.totalBoost(st('channel'), { xp: 1, coins: 1 }, m).xp, 1.5, 'no channel bonus: the role counts');
    assert.strictEqual(boosts.totalBoost(st('role'), { xp: 2, coins: 1 }, m).xp, 1.5);
    assert.strictEqual(boosts.totalBoost(st('largest'), { xp: 5, coins: 5 }, roleMember([R1, MUTE])).xp, 0, 'muted role');
    assert.strictEqual(boosts.totalBoost(st('largest'), { xp: 0, coins: 0 }, m).xp, 0, 'channel x0');
    assert.strictEqual(boosts.stack(10, 10, 'multiply'), 20);
  });

  await test('chat XP follows the role multiplier; a x0 role earns nothing', async () => {
    const s = await leveling.getOrCreateSettings(G);
    Object.assign(s, { xpPerMessageMin: 10, xpPerMessageMax: 10, xpCooldownSeconds: 0, chatCoinsPerMessage: 4, roleBoosts: JSON.stringify({ [R1]: { xp: 3, coins: 2 }, [MUTE]: { xp: 0, coins: 0 } }) });
    await s.save();
    const r = await leveling.grantMessageXp(G, '555000000000000001', [], roleMember([R1]));
    assert(r && r.gained === 30 && r.coins === 8, JSON.stringify({ gained: r?.gained, coins: r?.coins }));
    const none = await leveling.grantMessageXp(G, '555000000000000002', [], roleMember([MUTE]));
    assert.strictEqual(none, null);
  });

  const levelUp = require('../bot/utils/levelUp');
  await test('level-up message: off, every N-th level until X, only levels with a role', async () => {
    assert(!levelUp.shouldAnnounce({ levelUpDestination: 'off' }, 5));
    const every = { levelUpEvery: 5, levelUpEveryUntil: 30 };
    assert(levelUp.shouldAnnounce(every, 10) && !levelUp.shouldAnnounce(every, 11) && levelUp.shouldAnnounce(every, 31), 'every 5th until 30');
    assert(!levelUp.shouldAnnounce({ levelUpEvery: 5, levelUpEveryUntil: 0 }, 33) && levelUp.shouldAnnounce({ levelUpEvery: 5 }, 35), 'until 0 = always');
    assert(levelUp.shouldAnnounce({ levelUpRewardOnly: true }, 10, [10]) && !levelUp.shouldAnnounce({ levelUpRewardOnly: true }, 11, [10]));
    assert.strictEqual(levelUp.fillLevelUpText('{user} {name} {oldLevel}→{level} {role} {crystals} {server}', { userId: '1', name: 'Ann', level: 5, oldLevel: 4, roleName: 'VIP', crystals: 2, server: 'S' }), '<@1> Ann 4→5 VIP 2 S');
  });

  await test('level-up message: own text in plain form pings only the member; DM mode writes privately; a jump over the N-th level counts', async () => {
    const sent = []; const dms = [];
    const channel = { send: async (p) => sent.push(p) };
    const user = { id: '555000000000000009', username: 'ann', displayAvatarURL: () => '' };
    const guild = { id: G, name: 'S', roles: { cache: new Map() }, iconURL: () => null };
    const settings = { levelUpMessage: '{user} теперь {level}!', levelUpEmbed: false, levelUpDestination: 'auto' };
    await levelUp.announceLevelUp({ guild, user, displayName: 'Ann', level: 3, oldLevel: 2, channel, settings });
    assert(sent[0].content === '<@555000000000000009> теперь 3!' && sent[0].allowedMentions.users[0] === user.id, JSON.stringify(sent[0]));
    await levelUp.announceLevelUp({ guild, user, level: 4, oldLevel: 3, channel, settings: { ...settings, levelUpDestination: 'dm' }, member: { send: async (p) => dms.push(p) } });
    assert(dms.length === 1 && sent.length === 1, 'DM, not the channel');
    await levelUp.announceLevelUp({ guild, user, level: 11, oldLevel: 9, channel, settings: { levelUpEvery: 5 } });
    assert.strictEqual(sent.length, 2, '9 → 11 passes 10');
    await levelUp.announceLevelUp({ guild, user, level: 12, oldLevel: 11, channel, settings: { levelUpEvery: 5 } });
    assert.strictEqual(sent.length, 2, '12 is skipped');
    const std = sent[1].embeds[0].toJSON(); assert(std.title.includes('Поздравляю') && std.description.includes('11'), 'the standard frame without own text');
  });

  await test('"keep": in replace mode a kept role stays, the others give way to the highest one', async () => {
    const lr = require('../bot/modules/levelRoles');
    const rows = [{ level: 5, roleId: 'a', keep: true }, { level: 10, roleId: 'b' }, { level: 20, roleId: 'c' }];
    assert.deepStrictEqual(lr.computeRoleChanges(rows, 25, ['a', 'b'], true), { add: ['c'], remove: ['b'] });
    assert.deepStrictEqual(lr.computeTrackRoleChanges(rows, 25, [], true).add.sort(), ['a', 'c']);
    assert.deepStrictEqual(lr.computeAdjustRoleChanges(rows, 12, ['a', 'c'], true, true), { add: ['b'], remove: ['c'] });
  });

  // ---- commands ----
  const { makeInteraction, makeUser } = require('./mock');
  await test('/calc: XP left, messages and voice time, with the role multiplier', async () => {
    const profile = require('../bot/commands/leveling/profile');
    await db.MemberProfile.update({ xp: 0, level: 0 }, { where: { guildId: G, userId: '555000000000000001' } });
    const i = makeInteraction({ guildId: G, options: { level: 5 }, member: roleMember([R1]) });
    i.guild.id = G; i.user = makeUser('555000000000000001'); i.options.getSubcommand = () => 'calc';
    await profile.execute(i);
    const d = i._replies[0].embeds[0].toJSON().description;
    assert(d.includes('Осталось') && d.includes('Сообщений') && d.includes('×3'), d);
  });

  await test('/level set: changes the level and reports it; needs Manage Server', async () => {
    const level = require('../bot/commands/leveling/level');
    const target = makeUser('555000000000000005');
    const i = makeInteraction({ guildId: G, subcommand: 'set', options: { user: target, amount: 7 } });
    i.guild.id = G; i.guild.members.fetch = async () => null;
    await level.execute(i);
    const p = await db.MemberProfile.findOne({ where: { guildId: G, userId: target.id } });
    assert(p.level === 7 && Number(p.xp) === leveling.totalXpForLevel(7), JSON.stringify(p.toJSON()));
    assert(i._replies[0].embeds[0].toJSON().description.includes('**7**'));
    const weak = makeInteraction({ guildId: G, subcommand: 'set', options: { user: target, amount: 1 } });
    weak.member.permissions.has = () => false;
    await level.execute(weak);
    assert((await db.MemberProfile.findOne({ where: { guildId: G, userId: target.id } })).level === 7, 'refused');
  });

  await test('"Профиль" menu: the profile of the clicked member, answered privately', async () => {
    const menu = require('../bot/commands/leveling/profileMenu');
    assert.strictEqual(menu.data.toJSON().name_localizations.ru, 'Профиль');
    let deferred = null; let shownUser = null;
    const profile = require('../bot/commands/leveling/profile');
    const real = profile.execute; profile.execute = async (i) => { deferred = i.privateAnswer; shownUser = i.options.getUser('user'); };
    await menu.execute({ targetUser: { id: 'T' }, options: {} });
    profile.execute = real;
    assert(deferred === true && shownUser.id === 'T');
  });

  // ---- panel ----
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((q, r, n) => { q.user = { id: 'ADMIN', username: 'x' }; r.locals.user = q.user; n(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use('/top', require('../web/routes/publicTop'));
  const server = app.listen(0); const root = `http://127.0.0.1:${server.address().port}`; const base = `${root}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));
  const settingsNow = () => db.GuildSettings.findByPk(G);

  await test('panel: role multipliers are added, shown, combined by the chosen modes and removed', async () => {
    assert((await post('/channel-boosts/roles', { roleId: R2, xp: '1,5', coins: '2' })).includes('saved'));
    assert((await post('/channel-boosts/roles', { roleId: '600000000000000099', xp: '2', coins: '2' })).includes('invalid'), 'unknown role');
    assert((await post('/channel-boosts/roles', { roleId: R2, xp: 'abc', coins: '2' })).includes('invalid'), 'bad number');
    assert.deepStrictEqual(JSON.parse((await settingsNow()).roleBoosts)[R2], { xp: 1.5, coins: 2 });
    assert((await post('/channel-boosts/modes', { roleBoostMode: 'add', boostStacking: 'largest' })).includes('saved'));
    const s = await settingsNow(); assert(s.roleBoostMode === 'add' && s.boostStacking === 'largest');
    await post('/channel-boosts/modes', { roleBoostMode: 'evil', boostStacking: 'x' });
    assert((await settingsNow()).roleBoostMode === 'add', 'unknown modes are ignored');
    const page = await (await fetch(base + '/channel-boosts')).text();
    assert(page.includes('Бонусы ролей') && page.includes('@VIP') && page.includes('×1,5'), 'listed');
    assert((await post(`/channel-boosts/roles/delete/${R2}`, {})).includes('deleted'));
    assert(!JSON.parse((await settingsNow()).roleBoosts)[R2]);
  });

  await test('panel: the level-up message settings are saved and limited', async () => {
    await post('/leveling', { levelingEnabled: 'on', chatEnabled: 'on', levelUpDestination: 'dm', levelUpMessage: '  {user} — {level}!  ', levelUpEvery: '500', levelUpEveryUntil: '40', levelUpRewardOnly: 'on' });
    const s = await settingsNow();
    assert(s.levelUpDestination === 'dm' && s.levelUpMessage === '{user} — {level}!' && s.levelUpEvery === 100 && s.levelUpEveryUntil === 40 && s.levelUpRewardOnly === true && s.levelUpEmbed === false, JSON.stringify(s.toJSON()));
    await post('/leveling', { levelUpDestination: 'nowhere', levelUpMessage: '' });
    const t = await settingsNow(); assert(t.levelUpDestination === 'auto' && t.levelUpMessage === null);
    const page = await (await fetch(base + '/leveling')).text(); assert(page.includes('Поздравлять каждый N-й уровень'));
  });

  await test('panel: "keep" is set when adding a level role and switched in the table', async () => {
    assert((await post('/level-roles', { level: '5', roleId: R2, keep: 'on' })).includes('saved'));
    const row = await db.LevelRole.findOne({ where: { guildId: G, level: 5 } }); assert(row.keep === true);
    await post(`/level-roles/keep/${row.id}`, { keep: '' });
    assert((await row.reload()).keep === false);
    const page = await (await fetch(base + '/level-roles')).text(); assert(page.includes('Оставлять'));
  });

  await test('public leaderboard: hidden until switched on; minimum level; no sign-in needed', async () => {
    for (let k = 0; k < 4; k++) await db.MemberProfile.upsert({ guildId: G, userId: `55500000000000010${k}`, xp: 1000 * (k + 1), level: k * 3 });
    await db.GuildSettings.update({ levelingEnabled: true }, { where: { guildId: G } });
    assert.strictEqual((await fetch(`${root}/top/${G}`)).status, 404, 'off by default');
    assert.strictEqual((await fetch(`${root}/top/abc`)).status, 404);
    assert((await post('/leaderboard/public', { leaderboardPublic: 'on', leaderboardMinLevel: '5' })).includes('saved'));
    const r = await fetch(`${root}/top/${G}`); const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert(html.includes('Тёмный клуб') && html.includes('u03') && html.includes('u02') && !html.includes('u01') && !html.includes('u00'), 'levels 6 and 9 only');
    assert(!/<script>/.test(html), 'no inline script');
    const panel = await (await fetch(base + '/leaderboard')).text(); assert(panel.includes(`/top/${G}`), 'the link is shown in the panel');
  });

  server.close();
  console.log(results.join('\n'));
  console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
