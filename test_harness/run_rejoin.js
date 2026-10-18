// A member who leaves and comes back: roles, nickname and a running timeout return; level, wallet and warnings never go away.
process.env.DATABASE_PATH = './data/test_rejoin.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');
const { PermissionsBitField } = require('discord.js');
const F = PermissionsBitField.Flags;

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings, MemberSnapshot, MemberProfile, Warning } = db;
  const R = require('../bot/modules/memberRestore');
  const remove = require('../bot/events/guildMemberRemove'); const add = require('../bot/events/guildMemberAdd');
  const banEvents = require('../bot/events/memberRestoreEvents');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  let n = 0;
  const role = (id, o = {}) => ({ id, position: 5, managed: false, permissions: { any: (p) => (o.staff ? p.includes(F.Administrator) || p.includes(F.BanMembers) : false) }, ...o });
  // a server: the roles it has, the bot's top role at position 10, and who is banned
  const world = async (settings = {}) => {
    const id = 'rj' + ++n; const roles = new Map();
    for (const r of [role('R1'), role('R2'), role('MOD', { staff: true }), role('BOOST', { managed: true }), role('HIGH', { position: 20 })]) roles.set(r.id, r);
    const guild = { id, name: 'S', memberCount: 5, roles: { cache: roles }, members: { me: { roles: { highest: { position: 10 } } } }, bans: { _banned: new Set(), fetch: async ({ user }) => { if (guild.bans._banned.has(user)) return {}; throw new Error('Unknown Ban'); } }, channels: { fetch: async () => null } };
    await GuildSettings.create({ guildId: id, welcomeEnabled: false, ...settings });
    return guild;
  };
  const leaving = (guild, uid, o = {}) => ({ id: uid, guild, user: { id: uid, bot: false, username: 'u' }, partial: false, nickname: o.nickname ?? null, communicationDisabledUntilTimestamp: o.until ?? null, roles: { cache: new Map([[guild.id, { id: guild.id }], ...(o.roles || []).map((r) => [r, guild.roles.cache.get(r)])]) }, displayName: 'u' });
  const joining = (guild, uid, o = {}) => {
    const m = { id: uid, guild, user: { id: uid, bot: false, username: 'u' }, nickname: null, manageable: true, displayName: 'u', _added: [], _nick: null, _timeouts: [],
      roles: { cache: new Map((o.has || []).map((r) => [r, { id: r }])), add: async (ids) => { const list = [].concat(ids); if (o.failBulk && list.length > 1) throw new Error('Missing Permissions'); for (const id of list) { if (o.denyRole === id) throw new Error('Missing Permissions'); m._added.push(id); m.roles.cache.set(id, { id }); } } },
      setNickname: async (nick) => { if (o.denyNick) throw new Error('Missing Permissions'); m._nick = nick; }, timeout: async (ms) => { if (o.denyTimeout) throw new Error('Missing Permissions'); m._timeouts.push(ms); } };
    return m;
  };
  const leave = (g, uid, o) => remove.execute(leaving(g, uid, o));
  const join = async (g, uid, o) => { const m = joining(g, uid, o); await add.execute(m); return m; };

  await test('leaving saves roles and nickname; coming back gives them back (even with the welcome message off)', async () => {
    const g = await world(); await leave(g, 'U1', { roles: ['R1', 'R2'], nickname: 'Нея' });
    const snap = await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U1' } }); assert(snap && JSON.parse(snap.roleIds).join() === 'R1,R2' && snap.nickname === 'Нея', 'saved');
    const m = await join(g, 'U1'); assert(m._added.join() === 'R1,R2' && m._nick === 'Нея', m._added.join() + m._nick);
    assert(!await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U1' } }), 'used once');
    const again = await join(g, 'U1'); assert(!again._added.length, 'a second return gets nothing');
  });
  await test('what must not come back: @everyone, deleted roles, boosters/bots, roles above the bot, staff roles (unless allowed)', async () => {
    const g = await world(); await leave(g, 'U2', { roles: ['R1', 'MOD', 'BOOST', 'HIGH'] }); g.roles.cache.set('GONE', role('GONE')); await MemberSnapshot.update({ roleIds: JSON.stringify(['R1', 'MOD', 'BOOST', 'HIGH', 'GONE', g.id, 'NEVER']) }, { where: { guildId: g.id, userId: 'U2' } }); g.roles.cache.delete('GONE');
    const m = await join(g, 'U2'); assert(m._added.join() === 'R1', 'only R1, got ' + m._added.join());
    const g2 = await world({ restoreStaffRoles: true }); await leave(g2, 'U2', { roles: ['R1', 'MOD'] });
    assert((await join(g2, 'U2'))._added.join() === 'R1,MOD', 'staff allowed by the admin');
  });
  await test('a role he already got on joining (autorole) is not given twice', async () => {
    const g = await world(); await leave(g, 'U3', { roles: ['R1', 'R2'] });
    const m = await join(g, 'U3', { has: ['R1'] }); assert(m._added.join() === 'R2', m._added.join());
  });
  await test('switched off: nothing is saved and nothing is given', async () => {
    const g = await world({ restoreOnRejoin: false }); await leave(g, 'U4', { roles: ['R1'] });
    assert(!await MemberSnapshot.findOne({ where: { guildId: g.id } }), 'nothing saved');
    await MemberSnapshot.create({ guildId: g.id, userId: 'U4', roleIds: '["R1"]', leftAt: new Date() }); assert(!(await join(g, 'U4'))._added.length, 'nothing given');
  });
  await test('too long ago: not given, and the old rows are cleaned up each day', async () => {
    const g = await world({ restoreDays: 30 }); const old = new Date(Date.now() - 31 * 86400000);
    await MemberSnapshot.create({ guildId: g.id, userId: 'U5', roleIds: '["R1"]', leftAt: old }); await MemberSnapshot.create({ guildId: g.id, userId: 'U6', roleIds: '["R1"]', leftAt: new Date(Date.now() - 10 * 86400000) });
    assert(!(await join(g, 'U5'))._added.length, 'expired'); await MemberSnapshot.create({ guildId: g.id, userId: 'U5', roleIds: '["R1"]', leftAt: old });
    assert(await R.purgeOld() >= 1 && !await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U5' } }) && await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U6' } }), 'purge keeps the fresh one');
  });
  await test('a banned member comes back after an unban with nothing; a ban also wipes an older snapshot', async () => {
    const g = await world(); g.bans._banned.add('U7'); await leave(g, 'U7', { roles: ['R1'] });
    assert(!await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U7' } }), 'not saved for a banned member');
    await MemberSnapshot.create({ guildId: g.id, userId: 'U8', roleIds: '["R1"]', leftAt: new Date() });
    await banEvents[0].execute({ guild: g, user: { id: 'U8' } }); assert(!await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U8' } }), 'forgotten on ban');
  });
  await test('unknown roles (member not in the cache) keep the older snapshot instead of erasing it; bots are ignored', async () => {
    const g = await world(); await leave(g, 'U9', { roles: ['R2'] });
    const partial = leaving(g, 'U9'); partial.partial = true; partial.roles = undefined; await remove.execute(partial);
    assert(JSON.parse((await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U9' } })).roleIds).join() === 'R2', 'kept');
    const bot = leaving(g, 'BOT9', { roles: ['R1'] }); bot.user.bot = true; await remove.execute(bot); assert(!await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'BOT9' } }), 'bot ignored');
  });
  await test('a timeout that was still running continues after he comes back; a finished one is not applied', async () => {
    const g = await world(); await leave(g, 'U10', { until: Date.now() + 3600_000 });
    const m = await join(g, 'U10'); assert(m._timeouts.length === 1 && m._timeouts[0] > 3500_000 && m._timeouts[0] <= 3600_000, JSON.stringify(m._timeouts));
    await leave(g, 'U11', { until: Date.now() - 1000 }); assert(!await MemberSnapshot.findOne({ where: { guildId: g.id, userId: 'U11' } }), 'a finished timeout alone saves nothing');
    await MemberSnapshot.create({ guildId: g.id, userId: 'U12', roleIds: '[]', mutedUntil: new Date(Date.now() - 5000), leftAt: new Date() }); assert(!(await join(g, 'U12'))._timeouts.length, 'finished: not applied');
  });
  await test('Discord refusals do not break the return: one role fails, the others are still given; nickname refusal is fine', async () => {
    const g = await world(); await leave(g, 'U13', { roles: ['R1', 'R2'], nickname: 'Ник' });
    const m = await join(g, 'U13', { failBulk: true, denyRole: 'R1', denyNick: true }); assert(m._added.join() === 'R2' && m._nick === null, m._added.join());
    const g2 = await world(); await leave(g2, 'U14', { until: Date.now() + 60_000 }); assert(!(await join(g2, 'U14', { denyTimeout: true }))._timeouts.length, 'no crash');
  });
  await test('level, XP, wallet and warnings are still there after leaving and returning; level roles are reapplied', async () => {
    const g = await world(); await MemberProfile.create({ guildId: g.id, userId: 'U15', xp: 5000, level: 7, balance: 321, crystals: 4 }); await Warning.create({ guildId: g.id, userId: 'U15', moderatorId: 'M', reason: 'x' });
    const levelRoles = require('../bot/modules/levelRoles'); const real = levelRoles.applyLevelRoles; const calls = []; levelRoles.applyLevelRoles = async (m, lv) => { calls.push([m.id, lv]); };
    await leave(g, 'U15', { roles: ['R1'] }); const p = await MemberProfile.findOne({ where: { guildId: g.id, userId: 'U15' } });
    assert(p && p.level === 7 && Number(p.balance) === 321 && Number(p.crystals) === 4 && await Warning.count({ where: { guildId: g.id, userId: 'U15' } }) === 1, 'untouched by leaving');
    const m = await join(g, 'U15'); levelRoles.applyLevelRoles = real; assert(calls.length === 1 && calls[0][0] === 'U15' && m._added.join() === 'R1', JSON.stringify(calls));
    assert(Number((await MemberProfile.findOne({ where: { guildId: g.id, userId: 'U15' } })).balance) === 321, 'wallet still there');
  });
  await test('leaving twice at once keeps exactly one snapshot', async () => {
    const g = await world(); await Promise.all([leave(g, 'U16', { roles: ['R1'] }), leave(g, 'U16', { roles: ['R2'] }), leave(g, 'U16', { roles: ['R1', 'R2'] })]);
    assert(await MemberSnapshot.count({ where: { guildId: g.id, userId: 'U16' } }) === 1, 'one row');
  });

  // ---- the panel ----
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard')); app.use((err, q, s, nx) => s.status(500).send(String(err.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/777000000000000001/welcome`;
  const post = (b) => fetch(base, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await test('panel: the three settings are shown, saved, and the days are kept within limits', async () => {
    let html = await (await fetch(base)).text(); assert(/name="restoreOnRejoin"[^>]*checked/.test(html) && !/name="restoreStaffRoles"[^>]*checked/.test(html), 'defaults');
    await post({ restoreDays: '90', restoreStaffRoles: 'on' });
    const s = await GuildSettings.findByPk('777000000000000001'); assert(s.restoreOnRejoin === false && s.restoreDays === 90 && s.restoreStaffRoles === true, JSON.stringify([s.restoreOnRejoin, s.restoreDays, s.restoreStaffRoles]));
    await post({ restoreOnRejoin: 'on', restoreDays: '999999' }); assert((await GuildSettings.findByPk('777000000000000001')).restoreDays === 3650, 'upper limit');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
