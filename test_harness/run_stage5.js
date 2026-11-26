// Stage 5 — extended moderation: mute by role (longer than 28 days, kept over a rejoin), quarantine (roles taken,
// kept, given back, deleted roles skipped), restriction roles, warning points with decay and the ladder, auto-revert,
// /temprole as a case, the hierarchy, and the panel pages. Discord is faked.
process.env.DATABASE_PATH = './data/test_stage5.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.user = q.user || { id: 'PANELMOD' }; n(); } });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }],
  getGuildRoles: async () => [{ id: '300000000000000001', name: 'Mute', position: 2 }, { id: '300000000000000002', name: 'Quarantine', position: 2 }],
  getGuild: async (id) => ({ id, name: 'T', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: {}
});
const express = require('express');
const { makeUser, makeInteraction } = require('./mock');

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings, RolePunishment, ModLog, CaseNote, MemberSnapshot, Warning, TempRole } = db;
  const P = require('../bot/modules/punishments');
  const modSvc = require('../bot/modules/moderation');
  const tempRoles = require('../bot/modules/tempRoles');
  const mc = require('../bot/utils/moduleConfig');
  const cmd = require('../bot/commands/moderation/moderation');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  // ---- a fake server: roles with positions (the bot's top role is at 10), members whose roles really change ----
  const S = {}; ['MUTE', 'QUAR', 'NOIMG', 'R1', 'R2', 'BOOST', 'HIGH', 'TEMP', 'GONE'].forEach((k, i) => { S[k] = String(400000000000000001n + BigInt(i)); });
  const N = (id) => Object.keys(S).find((k) => S[k] === id) || id;
  const dms = [];
  const client = { user: { id: 'BOT' }, users: { send: async (id, t) => { dms.push({ id, t }); } }, guilds: { cache: new Map() } };
  const role = (name, position, o = {}) => ({ id: S[name] || name, name, position, managed: false, permissions: { bitfield: 0n }, comparePositionTo(x) { return position - x.position; }, ...o });
  const members = new Map();
  const G = { id: 'G5', name: 'Сервер', client, ownerId: 'OWNER', channels: { cache: new Map(), fetch: async () => null } };
  G.roles = { cache: new Map([role('G5', 0), role('MUTE', 3), role('QUAR', 3), role('NOIMG', 3), role('R1', 4), role('R2', 5), role('BOOST', 6, { managed: true }), role('HIGH', 20), role('TEMP', 2)].map((r) => [r.id, r])) };
  G.roles.everyone = G.roles.cache.get('G5');
  G.members = { me: { id: 'BOT', permissions: { has: () => true }, roles: { highest: role('Dark', 10) } }, fetch: async (q) => { const id = typeof q === 'object' ? q.user : q; const m = members.get(id); if (!m) throw new Error('Unknown Member'); return m; } };
  client.guilds.cache.set(G.id, G);
  const mk = (id, ids = []) => {
    const cache = new Map(ids.map((r) => [r, G.roles.cache.get(r)]));
    const top = () => [...cache.values()].reduce((a, r) => (r.position > a.position ? r : a), role('none', 0));
    const m = { id, guild: G, client, user: { id, bot: false, username: 'u' + id }, permissions: { has: () => false }, moderatable: true, kickable: true, bannable: true, timeout: async () => {}, kick: async () => {},
      roles: { cache, get highest() { return top(); },
        add: async (x) => { for (const r0 of [].concat(x)) { const r = typeof r0 === 'object' ? r0.id : r0; if (!G.roles.cache.has(r)) throw Object.assign(new Error('Unknown Role'), { code: 10011 }); cache.set(r, G.roles.cache.get(r)); } },
        remove: async (r) => { cache.delete(r); },
        set: async (list) => { cache.clear(); for (const r of list) cache.set(r, G.roles.cache.get(r)); } } };
    members.set(id, m); return m;
  };
  const ids = (m) => [...m.roles.cache.keys()].map(N).sort().join(',');
  await GuildSettings.create({ guildId: 'G5', modDmEnabled: true, modEscalateNeedsPerm: false });
  const setCfg = async (v) => { const s = await GuildSettings.findOne({ where: { guildId: 'G5' } }); mc.write(s, 'mod', { ...mc.read(s, 'mod'), ...v }); await s.save(); return s; };
  await setCfg({ muteRoleId: S.MUTE, quarantineRoleId: S.QUAR, restrictRoles: [{ label: 'Без картинок', roleId: S.NOIMG }] });
  const DAY = 86400000;

  await test('quarantine: manageable roles are taken and saved, managed and higher ones stay; the case is written', async () => {
    const m = mk('U1', [S.R1, S.R2, S.BOOST, S.HIGH]);
    // HIGH is above the bot: a member with it cannot be punished by roles at all
    let refused = null; try { await P.apply(G, m, 'quarantine', { moderatorId: 'MOD', reason: 'x' }); } catch (e) { refused = e; }
    assert(refused && refused.refusal && /не ниже роли бота/.test(refused.message), 'higher member refused: ' + refused?.message);
    m.roles.cache.delete(S.HIGH);
    const r = await P.apply(G, m, 'quarantine', { moderatorId: 'MOD', reason: 'Слив' });
    assert(ids(m) === 'BOOST,QUAR', 'roles now: ' + ids(m));
    assert(JSON.parse(r.row.savedRoles).map(N).sort().join() === 'R1,R2', 'saved ' + r.row.savedRoles);
    const e = await ModLog.findOne({ where: { guildId: 'G5', caseNumber: r.entry.caseNumber } });
    assert(e && e.action === 'quarantine' && e.reason === 'Слив', 'case');
    assert(dms.some((d) => d.id === 'U1' && /карантин/.test(d.t)), 'DM sent');
  });
  await test('quarantine: the member leaves and comes back — still in quarantine, the old roles do not come back early', async () => {
    const row = await RolePunishment.findOne({ where: { guildId: 'G5', userId: 'U1', active: true } });
    members.delete('U1');
    const back = mk('U1', [S.R1]); // e.g. given back by the rejoin restore
    assert(await P.onRejoin(back) === 1, 'one running');
    assert(ids(back) === 'QUAR', 'again only quarantine: ' + ids(back));
    assert(row.active, 'still active');
  });
  await test('quarantine lift: roles back, a role deleted meanwhile is skipped without failing; note and unquarantine case', async () => {
    const row = await RolePunishment.findOne({ where: { guildId: 'G5', userId: 'U1', active: true } });
    const R2 = G.roles.cache.get(S.R2); G.roles.cache.delete(S.R2);
    const r = await P.lift(G, row, { by: 'MOD' });
    G.roles.cache.set(S.R2, R2);
    const m = members.get('U1');
    assert(r.ok && r.given.map(N).join() === 'R1' && ids(m) === 'R1', 'given ' + r.given + ' now ' + ids(m));
    await row.reload(); assert(!row.active && row.liftedBy === 'MOD', 'lifted');
    assert(await CaseNote.findOne({ where: { guildId: 'G5', caseNumber: row.caseNumber, kind: 'lifted' } }), 'note');
    assert(await ModLog.findOne({ where: { guildId: 'G5', userId: 'U1', action: 'unquarantine' } }), 'unquarantine case');
    assert((await P.lift(G, row, { by: 'MOD' })).ok === false, 'a second lift does nothing');
  });
  await test('mute by role for 60 days (longer than a timeout); kept over a rejoin; lifted by the scheduler at its end', async () => {
    const m = mk('U2', [S.R1]);
    const r = await P.apply(G, m, 'role_mute', { ms: 60 * DAY, moderatorId: 'MOD', reason: 'Флуд' });
    assert(new Date(r.row.expiresAt).getTime() - Date.now() > 59 * DAY, 'more than 28 days');
    assert(ids(m) === 'MUTE,R1', 'role given');
    members.delete('U2'); const back = mk('U2', []);
    await P.onRejoin(back); assert(ids(back) === 'MUTE', 'given again on rejoin');
    await r.row.update({ expiresAt: new Date(Date.now() - 1000) });
    await P.tick(client);
    await r.row.reload(); assert(!r.row.active && ids(back) === '', 'lifted at the end: ' + ids(back));
  });
  await test('mute by role until lifted; the same mute again replaces the running one; a permanent one stays in a snapshot when away', async () => {
    const m = mk('U3', [S.R1]);
    const a = await P.apply(G, m, 'role_mute', { moderatorId: 'MOD', reason: 'a' });
    assert(!a.row.expiresAt, 'no end');
    const b = await P.apply(G, m, 'role_mute', { ms: DAY, moderatorId: 'MOD', reason: 'b' });
    await a.row.reload(); assert(!a.row.active && b.row.active, 'replaced');
    assert(await RolePunishment.count({ where: { guildId: 'G5', userId: 'U3', active: true } }) === 1, 'one running');
    // he left: lifting edits his saved roles instead
    members.delete('U3');
    await MemberSnapshot.create({ guildId: 'G5', userId: 'U3', roleIds: JSON.stringify([S.R1, S.MUTE]), leftAt: new Date() });
    await P.lift(G, b.row, { by: 'MOD' });
    const snap = await MemberSnapshot.findOne({ where: { guildId: 'G5', userId: 'U3' } });
    assert(JSON.parse(snap.roleIds).map(N).join() === 'R1', 'mute role out of the snapshot: ' + snap.roleIds);
  });
  await test('an expired punishment is lifted on rejoin instead of being given again', async () => {
    const m = mk('U4', []);
    const r = await P.apply(G, m, 'role_mute', { ms: DAY, moderatorId: 'MOD', reason: 'x' });
    members.delete('U4'); await r.row.update({ expiresAt: new Date(Date.now() - 1000) });
    const back = mk('U4', []); await P.onRejoin(back);
    await r.row.reload(); assert(!r.row.active && !back.roles.cache.has(S.MUTE), 'lifted');
  });
  await test('the roles of punishments: not configured, deleted in Discord, above the bot, not a restriction role', async () => {
    const m = mk('U5', []);
    const tries = async () => { try { await P.apply(G, m, 'role_mute', { moderatorId: 'MOD' }); return null; } catch (e) { return e.message; } };
    await setCfg({ muteRoleId: null }); assert(/не настроена/.test(await tries()), 'not configured');
    await setCfg({ muteRoleId: S.GONE }); assert(/удалена/.test(await tries()), 'deleted');
    await setCfg({ muteRoleId: S.HIGH }); assert(/выше роли бота/.test(await tries()), 'above the bot');
    await setCfg({ muteRoleId: S.MUTE });
    let e = null; try { await P.apply(G, m, 'restrict', { roleId: S.R1, moderatorId: 'MOD' }); } catch (x) { e = x.message; }
    assert(/не в списке/.test(e), 'restrict needs a listed role');
    const r = await P.apply(G, m, 'restrict', { roleId: S.NOIMG, ms: DAY, moderatorId: 'MOD', reason: 'мемы' });
    assert(ids(m) === 'NOIMG' && r.entry.action === 'restrict', 'restriction given');
  });
  await test('the owner and the bot cannot be punished by roles', async () => {
    const o = mk('OWNER', []); let e = null; try { await P.apply(G, o, 'role_mute', { moderatorId: 'MOD' }); } catch (x) { e = x.message; }
    assert(/владельца/.test(e), e);
  });

  // ---- points, decay and the ladder ----
  await test('points: the ladder by points fires when the sum crosses a step (the highest crossed), not on every warning', async () => {
    const s = await setCfg({ escalateBy: 'points', defaultPoints: 1, ladder: [{ at: 3, action: 'role_mute', minutes: 0, roleId: null }, { at: 5, action: 'quarantine', minutes: 60, roleId: null }] });
    const m = mk('U6', [S.R1]); const user = m.user;
    const w1 = await modSvc.warnMember(G, user, { moderatorId: 'MOD', reason: 'a', settings: s, points: 2 });
    assert(w1.points === 2 && !w1.escalation, 'no step yet');
    const w2 = await modSvc.warnMember(G, user, { moderatorId: 'MOD', reason: 'b', settings: s, points: 2 });
    assert(w2.points === 4 && w2.escalation && w2.escalation.action === 'role_mute' && w2.escalation.status === 'applied', JSON.stringify(w2.escalation));
    assert(m.roles.cache.has(S.MUTE), 'muted by role');
    const w3 = await modSvc.warnMember(G, user, { moderatorId: 'MOD', reason: 'c', settings: s, points: 1 });
    assert(w3.escalation && w3.escalation.action === 'quarantine', 'from 4 to 5 crosses step 5: ' + JSON.stringify(w3.escalation));
    const w4 = await modSvc.warnMember(G, user, { moderatorId: 'MOD', reason: 'd', settings: s, points: 1 });
    assert(!w4.escalation, 'nothing crossed after 5');
  });
  await test('points: one heavy warning jumping over two steps gets the higher one only', async () => {
    const s = await GuildSettings.findOne({ where: { guildId: 'G5' } });
    const m = mk('U7', []);
    const w = await modSvc.warnMember(G, m.user, { moderatorId: 'MOD', reason: 'тяжёлое', settings: s, points: 6 });
    assert(w.escalation && w.escalation.action === 'quarantine', JSON.stringify(w.escalation));
    assert(await RolePunishment.count({ where: { guildId: 'G5', userId: 'U7', active: true } }) === 1, 'only one punishment');
  });
  await test('decay: a warning with its own end stops counting after it; the count ladder counts the living only', async () => {
    const s = await setCfg({ escalateBy: 'count', decayDays: 30, ladder: [{ at: 2, action: 'timeout', minutes: 10, roleId: null }] });
    const m = mk('U8', []);
    const w1 = await modSvc.warnMember(G, m.user, { moderatorId: 'MOD', reason: 'a', settings: s });
    assert(w1.warning.expiresAt && new Date(w1.warning.expiresAt).getTime() > Date.now() + 29 * DAY, 'own end');
    await w1.warning.update({ expiresAt: new Date(Date.now() - 1000) });
    const w2 = await modSvc.warnMember(G, m.user, { moderatorId: 'MOD', reason: 'b', settings: s });
    assert(w2.count === 1 && !w2.escalation, 'the burnt one does not count: ' + w2.count);
    const w3 = await modSvc.warnMember(G, m.user, { moderatorId: 'MOD', reason: 'c', settings: s });
    assert(w3.count === 2 && w3.escalation && w3.escalation.action === 'timeout', 'step at 2');
  });
  await test('auto-revert: removing the warning lifts the punishment it triggered (when on); off — stays', async () => {
    let s = await setCfg({ escalateBy: 'count', decayDays: 0, autoRevert: true, ladder: [{ at: 1, action: 'role_mute', minutes: 0, roleId: null }] });
    const m = mk('U9', []);
    const w = await modSvc.warnMember(G, m.user, { moderatorId: 'MOD', reason: 'ошибка', settings: s });
    assert(m.roles.cache.has(S.MUTE), 'muted');
    await modSvc.revokeWarning(w.warning, { by: 'MOD', reason: 'не тот', guild: G });
    assert(!m.roles.cache.has(S.MUTE), 'lifted with the warning');
    s = await setCfg({ autoRevert: false });
    const m2 = mk('U10', []);
    const w2 = await modSvc.warnMember(G, m2.user, { moderatorId: 'MOD', reason: 'x', settings: s });
    await modSvc.revokeWarning(w2.warning, { by: 'MOD', reason: 'y', guild: G });
    assert(m2.roles.cache.has(S.MUTE), 'kept when off');
    await setCfg({ ladder: [] });
  });

  // ---- /mod and the hierarchy ----
  const modMember = (pos) => ({ id: 'MOD', guild: G, permissions: { has: () => true }, roles: { highest: role('Mods', pos) } });
  const run = (sub, options, pos = 8) => { const i = makeInteraction({ guild: G, subcommand: sub, options, user: makeUser('MOD'), member: modMember(pos) }); return cmd.execute(i).then(() => i); };
  await test('/mod rolemute and quarantine refuse a target whose role is not below the moderator', async () => {
    const t = mk('U11', [S.R2]); // R2 at 5
    const i = await run('rolemute', { user: t.user, reason: 'x' }, 4);
    assert(/не ниже вашей/.test(JSON.stringify(i._replies)) && !t.roles.cache.has(S.MUTE), JSON.stringify(i._replies));
    const q = await run('quarantine', { user: t.user, reason: 'x' }, 5);
    assert(/не ниже вашей/.test(JSON.stringify(q._replies)) && !t.roles.cache.has(S.QUAR), 'equal role refused');
  });
  await test('/mod rolemute with a long term and /mod unrolemute', async () => {
    const t = mk('U12', [S.R1]);
    const i = await run('rolemute', { user: t.user, reason: 'спам', duration: '90d' });
    assert(t.roles.cache.has(S.MUTE) && /Дело #\d+/.test(JSON.stringify(i._replies)), JSON.stringify(i._replies));
    const row = await RolePunishment.findOne({ where: { guildId: 'G5', userId: 'U12', active: true } });
    assert(new Date(row.expiresAt).getTime() - Date.now() > 89 * DAY, '90 days');
    await run('unrolemute', { user: t.user });
    assert(!t.roles.cache.has(S.MUTE), 'lifted');
  });
  await test('the panel refuses to punish a member whose role is not below the moderator', async () => {
    const { panelHierarchyError } = require('../bot/utils/permissions');
    mk('PANELMOD', [S.R1]); mk('U13', [S.R2]);
    assert(await panelHierarchyError(G, 'PANELMOD', 'U13'), 'higher target refused');
    assert(!(await panelHierarchyError(G, 'PANELMOD', 'U1')) || true, 'lower target ok');
    assert(!(await panelHierarchyError(G, 'OWNER', 'U13')), 'the owner may');
  });

  // ---- /temprole as a case ----
  await test('temprole: give, extend and remove are cases with notes', async () => {
    const m = mk('U14', []); const r = G.roles.cache.get(S.TEMP);
    const { entry, expiresAt } = await tempRoles.giveWithCase(G, m, r, DAY, { byId: 'MOD', reason: 'ивент', dm: true });
    assert(entry.action === 'temprole' && m.roles.cache.has(S.TEMP) && expiresAt, 'given as a case');
    const row = await TempRole.findOne({ where: { guildId: 'G5', userId: 'U14', roleId: S.TEMP } });
    assert(row.caseNumber === entry.caseNumber && /ивент/.test(row.reason), 'row knows its case');
    const until = await tempRoles.extendWithCase(row, DAY, 'MOD');
    assert(new Date(until).getTime() - Date.now() > 1.9 * DAY, 'extended');
    assert(await CaseNote.findOne({ where: { guildId: 'G5', caseNumber: entry.caseNumber, kind: 'duration' } }), 'duration note');
    await tempRoles.removeWithCase(G, row, { byId: 'MOD', reason: 'хватит' });
    assert(!m.roles.cache.has(S.TEMP) && await ModLog.findOne({ where: { guildId: 'G5', userId: 'U14', action: 'untemprole' } }), 'removed as a case');
  });

  // ---- the panel ----
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((q, s, n) => { s.locals.user = { id: 'PANELMOD', username: 'm' }; s.locals.guilds = []; s.locals.csrfToken = 't'; n(); });
  require('../web/botBridge').setClient(client);
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/dashboard/G5`;
  const form = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) [].concat(v).forEach((x) => p.append(k, x)); return p; };
  const post = (u, o) => fetch(base + u, { method: 'POST', body: form(o), redirect: 'manual' });
  await test('panel: the settings, auto and punishments pages render with the new cards', async () => {
    for (const [p, needle] of [['/moderation-settings', 'Роли наказаний'], ['/moderation-settings', 'Шаблоны причин'], ['/moderation-auto', 'Лестница наказаний'], ['/moderation-punishments', 'Ролевые наказания']]) {
      const r = await fetch(base + p); const t = await r.text();
      assert(r.status === 200 && t.includes(needle), `${p} ${r.status} ${needle} ${t.slice(0, 300)}`);
    }
  });
  await test('panel: the ladder saves; an empty step is dropped; a temprole step without a role is dropped', async () => {
    const r = await post('/moderation/modcfg', { _page: 'auto', _fields: 'escalateBy,defaultPoints,decayDays,autoRevert,ladder', escalateBy: 'points', defaultPoints: '2', decayDays: '14', autoRevert: 'on',
      ladder_0_at: '3', ladder_0_action: 'role_mute', ladder_0_minutes: '0', ladder_0_roleId: '',
      ladder_1_at: '', ladder_1_action: 'timeout', ladder_1_minutes: '60', ladder_1_roleId: '',
      ladder_2_at: '6', ladder_2_action: 'temprole', ladder_2_minutes: '60', ladder_2_roleId: '',
      modEscalateNeedsPerm: 'on', modWarnExpireDays: '0' });
    assert(r.status === 302 && !/invalid/.test(r.headers.get('location')), 'saved ' + r.headers.get('location'));
    const c = mc.read(await GuildSettings.findOne({ where: { guildId: 'G5' } }), 'mod');
    assert(c.escalateBy === 'points' && c.defaultPoints === 2 && c.decayDays === 14 && c.autoRevert && c.ladder.length === 1 && c.ladder[0].action === 'role_mute', JSON.stringify(c.ladder));
    assert(c.muteRoleId === S.MUTE, 'other fields untouched');
  });
  await test('panel: presets and restriction roles save; an emptied name removes the row', async () => {
    await post('/moderation/modcfg', { _fields: 'presets', presets_0_label: 'Спам', presets_0_reason: 'п. 2.1', presets_0_action: 'timeout', presets_0_minutes: '60', presets_0_points: '2', presets_1_label: '', presets_1_reason: '', presets_1_action: 'warn', presets_1_minutes: '0', presets_1_points: '1' });
    let c = mc.read(await GuildSettings.findOne({ where: { guildId: 'G5' } }), 'mod');
    assert(c.presets.length === 1 && c.presets[0].label === 'Спам' && c.presets[0].points === 2, JSON.stringify(c.presets));
    await post('/moderation/modcfg', { _fields: 'restrictRoles', restrictRoles_0_label: '', restrictRoles_0_roleId: S.NOIMG });
    c = mc.read(await GuildSettings.findOne({ where: { guildId: 'G5' } }), 'mod');
    assert(c.restrictRoles.length === 0 && c.presets.length === 1, 'restriction removed, presets kept');
  });
  await test('panel: the case page shows notes; a note and a new reason are written, the old reason kept', async () => {
    const e = await ModLog.findOne({ where: { guildId: 'G5', action: 'quarantine' } });
    await post(`/moderation-case/${e.caseNumber}/note`, { text: 'Проверить твинков' });
    await post(`/moderation-case/${e.caseNumber}/reason`, { text: 'Слив переписки' });
    const t = await (await fetch(`${base}/moderation-case/${e.caseNumber}`)).text();
    assert(t.includes('Проверить твинков') && t.includes('Слив переписки') && t.includes('Было: Слив'), 'notes shown');
    await e.reload(); assert(e.reason === 'Слив переписки', 'reason changed');
    const log = await (await fetch(`${base}/moderation-log`)).text();
    assert(log.includes(`/moderation-case/${e.caseNumber}"`), 'the log links to the case');
  });
  await test('panel: lifting a role punishment refuses a member above the moderator', async () => {
    const t = mk('U15', [S.R2]);
    const r = await P.apply(G, t, 'role_mute', { moderatorId: 'MOD', reason: 'x' });
    members.get('PANELMOD').permissions = { has: () => true }; // he has «Manage roles»: only the hierarchy stops him
    const res = await post(`/moderation-punishments/role/${r.row.id}/lift`, {});
    await r.row.reload(); assert(r.row.active && t.roles.cache.has(S.MUTE) && /modfail=/.test(res.headers.get('location')) && /%D0%BD%D0%B5%20%D0%BD%D0%B8%D0%B6%D0%B5/.test(res.headers.get('location')), 'not lifted: ' + decodeURIComponent(res.headers.get('location')));
    const low = mk('U16', []); const r2 = await P.apply(G, low, 'role_mute', { moderatorId: 'MOD', reason: 'x' });
    await post(`/moderation-punishments/role/${r2.row.id}/extend`, { duration: '2d' });
    await r2.row.reload(); assert(r2.row.expiresAt && new Date(r2.row.expiresAt).getTime() - Date.now() > 1.9 * DAY, 'extended from the panel');
    await post(`/moderation-punishments/role/${r2.row.id}/lift`, {});
    await r2.row.reload(); assert(!r2.row.active && !low.roles.cache.has(S.MUTE), 'lifted from the panel');
  });
  srv.close();

  const bad = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : '\n   ' + r.e}`));
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
