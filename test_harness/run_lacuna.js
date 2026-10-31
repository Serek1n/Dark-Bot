// Features taken from Lacuna's documentation: templates (replacers), interactive messages, reaction roles v2, voice roles,
// temporary roles, reports v2, durations.
process.env.DATABASE_PATH = './data/test_lacuna.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', CH = '800000000000000001', R1 = '600000000000000001', R2 = '600000000000000002', R3 = '600000000000000003';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const posted = []; const deleted = [];
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getUsers: async () => ({}),
  getGuildChannels: async () => [{ id: CH, name: 'роли', type: 0 }, { id: '800000000000000002', name: 'голос', type: 2 }],
  getGuildRoles: async () => [{ id: R1, name: 'Красный', position: 1 }, { id: R2, name: 'Синий', position: 2 }, { id: R3, name: 'Админ', position: 3 }],
  getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: {
    get: require('./ownerGuild').ownerGet(G, [R1, R2, R3]),
    post: async (u, body) => { posted.push([u, body]); return { data: { id: 'MSG' + posted.length } }; },
    delete: async (u) => { deleted.push(u); return {}; }, put: async () => ({})
  }
});
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  const db = require('../db'); await db.init();
  const rp = require('../bot/utils/replacers');

  await test('templates: values, fallbacks, quoted text, old short forms, unknown names stay visible', async () => {
    const ctx = { member: { mention: '<@1>', display_name: 'Аня', nickname: null, username: 'anya', level: { level: 7, rank: 2 } }, guild: { name: 'Клуб', member_count: 21, description: null } };
    assert.strictEqual(rp.render('{ member.display_name } / {member.nickname | member.username} / { guild.description | "нет" } / {user} / { nope.x }', ctx, { user: '<@1>' }), 'Аня / anya / нет / <@1> / { nope.x }');
    assert.strictEqual(rp.render('ур. { member.level.level }, место { member.level.rank }', ctx), 'ур. 7, место 2');
  });

  await test('template functions: NUMDECL, MATH (no code execution), DATE, UPPER, TRUNCATE, REPLACE, RANDOM, errors shown', async () => {
    const r = (t) => rp.render(t, { guild: { member_count: 21 } });
    assert.strictEqual(r('{- NUMDECL({ guild.member_count }; участник|участника|участников) -}'), 'участник');
    assert.strictEqual(r('{- NUMDECL(5; участник|участника|участников) -}'), 'участников');
    assert.strictEqual(r('{- MATH(2 + 3 * (4 - 1); 1) -}'), '11.0');
    assert.strictEqual(r('{- MATH(process.exit()) -}'), '[MATH: неверное выражение]');
    assert.strictEqual(r('{- DATE(0; DD MMMM YYYY [в] HH:mm; +03:00) -}'), '01 января 1970 в 03:00');
    assert.strictEqual(r('{- UPPER(hi) -} {- TRUNCATE(абвгд; 3; …) -} {- REPLACE(a.b.c; .; -; g) -}'), 'HI абв… a-b-c');
    const n = Number(r('{- RANDOM(5; 6) -}')); assert(n === 5 || n === 6);
    assert.strictEqual(r('{- NOPE(1) -}'), '[NOPE: нет такой функции]');
    assert(r('{- UPPER({- LOWER(AB) -}) -}') === 'AB', 'nested');
  });

  await test('templates from real discord.js-like objects; welcome text keeps {user} and gains { guild.member_count }', async () => {
    const { fillTemplate } = require('../bot/events/guildMemberAdd');
    const guild = { id: G, name: 'Клуб', memberCount: 22, channels: { cache: new Map() }, members: { cache: new Map() } };
    const member = { id: '5', displayName: 'Боря', user: { username: 'borya', bot: false }, guild, roles: { cache: new Map() } };
    assert.strictEqual(fillTemplate('Привет, {user}! Ты {- MATH({ guild.member_count }) -}-й в { guild.name }', member), 'Привет, <@5>! Ты 22-й в Клуб');
  });

  await test('durations: fractions, months, years, milliseconds; old forms still work', async () => {
    const { parseDuration } = require('../bot/utils/duration');
    assert.strictEqual(parseDuration('0.5h'), 1800000); assert.strictEqual(parseDuration('1,5д'), 129600000);
    assert.strictEqual(parseDuration('1y'), 365 * 86400000); assert.strictEqual(parseDuration('2 года'), 2 * 365 * 86400000);
    assert.strictEqual(parseDuration('3мес'), 90 * 86400000); assert.strictEqual(parseDuration('1h30m'), 5400000); assert.strictEqual(parseDuration('10'), 600000);
    assert.strictEqual(parseDuration('abc'), null);
  });

  const im = require('../bot/modules/interactive');
  await test('interactive: toggle, add, remove and "one at a time"; the list sets exactly the chosen roles', async () => {
    const rec = (o) => ({ kind: 'buttons', mode: 'toggle', exclusive: false, items: JSON.stringify([{ roleIds: [R1] }, { roleIds: [R2] }]), ...o });
    const has = (ids) => (id) => ids.includes(id);
    assert.deepStrictEqual(im.computeChanges(rec(), [0], has([])), { add: [R1], remove: [] });
    assert.deepStrictEqual(im.computeChanges(rec(), [0], has([R1])), { add: [], remove: [R1] });
    assert.deepStrictEqual(im.computeChanges(rec({ mode: 'add' }), [0], has([R1])), { add: [], remove: [] });
    assert.deepStrictEqual(im.computeChanges(rec({ mode: 'remove' }), [1], has([R2])), { add: [], remove: [R2] });
    assert.deepStrictEqual(im.computeChanges(rec({ exclusive: true }), [1], has([R1])), { add: [R2], remove: [R1] });
    assert.deepStrictEqual(im.computeChanges(rec({ kind: 'select' }), [1], has([R1])), { add: [R2], remove: [R1] });
  });

  await test('interactive: buttons in rows of 5, list with min 0 / max 1 when exclusive, custom emoji parsed', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ label: 'b' + i, roleIds: [R1], style: 'success', emoji: i === 0 ? '<:fire:123456789012345678>' : '' }));
    const p = im.payloadFor({ id: 9, kind: 'buttons', content: 'x', items: JSON.stringify(items) });
    assert(p.components.length === 2 && p.components[0].toJSON().components.length === 5 && p.components[0].toJSON().components[0].custom_id === 'im:9:0');
    assert.strictEqual(p.components[0].toJSON().components[0].emoji.id, '123456789012345678');
    const l = im.payloadFor({ id: 9, kind: 'select', exclusive: true, content: 'x', items: JSON.stringify(items.slice(0, 3)) }).components[0].toJSON().components[0];
    assert(l.min_values === 0 && l.max_values === 1 && l.options.length === 3);
  });

  await test('interactive: pressing a button changes the roles of the one who pressed', async () => {
    const r = await db.InteractiveMessage.create({ guildId: G, channelId: CH, content: 'x', kind: 'buttons', mode: 'toggle', items: JSON.stringify([{ roleIds: [R1] }]) });
    const roles = new Set(); const replies = [];
    const member = { roles: { cache: { has: (id) => roles.has(id) }, add: async (id) => roles.add(id), remove: async (id) => roles.delete(id) } };
    const guild = { roles: { cache: new Map([[R1, { id: R1, editable: true, managed: false }]]) }, members: { fetch: async () => member } };
    const i = { customId: `im:${r.id}:0`, guildId: G, guild, member, user: { id: 'U' }, deferReply: async () => { i.deferred = true; }, editReply: async (p) => replies.push(p), reply: async (p) => replies.push(p) };
    await im.handleInteractive(i);
    assert(roles.has(R1) && replies[0].content.includes('Выданы'));
    await im.handleInteractive({ ...i, deferred: false });
    assert(!roles.has(R1), 'second press takes it away');
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));

  await test('panel: an interactive message is published with its buttons; bad input refused; delete removes it in Discord too', async () => {
    const body = new URLSearchParams({ channelId: CH, content: 'Выберите цвет', kind: 'buttons', mode: 'toggle', exclusive: 'on' });
    for (const [l, r] of [['Красный', R1], ['Синий', R2], ['', '']]) { body.append('label', l); body.append('role', r); body.append('emoji', ''); body.append('style', 'primary'); body.append('description', ''); }
    const loc = await fetch(base + '/interactive', { method: 'POST', body, redirect: 'manual' }).then((r) => r.headers.get('location'));
    assert(loc.includes('saved'), loc);
    const sent = posted.find(([u]) => u === `/channels/${CH}/messages`); assert(sent && sent[1].components[0].components.length === 2, 'two buttons, the empty row skipped');
    const rec = await db.InteractiveMessage.findOne({ where: { guildId: G, messageId: 'MSG' + posted.length } }); assert(rec && rec.exclusive === true);
    assert((await post('/interactive', { channelId: '899999999999999999', content: 'x', role: R1 })).includes('badchannel'));
    assert((await post('/interactive', { channelId: CH, content: '', role: R1 })).includes('invalid'));
    const page = await (await fetch(base + '/interactive')).text(); assert(page.includes('Выберите цвет') && page.includes('Опубликовать'));
    assert((await post(`/interactive/${rec.id}/delete`, {})).includes('deleted') && deleted.some((u) => u.includes(rec.messageId)) && !(await db.InteractiveMessage.findByPk(rec.id)));
  });

  await test('panel: template preview fills values for the person editing', async () => {
    const r = await fetch(base + '/replacers/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '{user}, {- UPPER(ok) -} {- NUMDECL(3; день|дня|дней) -}' }) }).then((x) => x.json());
    assert(r.ok && r.text.endsWith('OK дня') && r.text.startsWith('@'), r.text);
  });

  await test('reaction roles v2: several roles, "one per message" and "reverse" modes', async () => {
    const rr = require('../bot/modules/reactionRoles');
    await db.ReactionRole.create({ guildId: G, channelId: CH, messageId: 'M1', emoji: '🔴', roleId: R1, extraRoleIds: JSON.stringify([R3]), mode: 'single' });
    await db.ReactionRole.create({ guildId: G, channelId: CH, messageId: 'M1', emoji: '🔵', roleId: R2, mode: 'single' });
    await db.ReactionRole.create({ guildId: G, channelId: CH, messageId: 'M2', emoji: '🔕', roleId: R2, mode: 'reverse' });
    const roles = new Set([R2]); const removedReactions = [];
    const member = { roles: { cache: { has: (id) => roles.has(id) }, add: async (r) => roles.add(r.id), remove: async (r) => roles.delete(r.id) } };
    const roleObj = (id) => ({ id, editable: true, managed: false });
    const guild = { roles: { cache: new Map([[R1, roleObj(R1)], [R2, roleObj(R2)], [R3, roleObj(R3)]]) }, members: { fetch: async () => member } };
    const message = (id) => ({ id, channelId: CH, guild, client: { rest: { delete: async (route) => { if (route.includes('/reactions/')) removedReactions.push(route.split('/').pop()); } } } });
    await rr.handleReactionRole({ message: message('M1'), emoji: { name: '🔴', id: null } }, { id: 'U' }, true);
    assert(roles.has(R1) && roles.has(R3) && !roles.has(R2), [...roles].join());
    assert.deepStrictEqual(removedReactions, ['U'], 'the other reaction was taken off');
    await rr.handleReactionRole({ message: message('M2'), emoji: { name: '🔕', id: null } }, { id: 'U' }, false);
    assert(roles.has(R2), 'reverse: removing the reaction gives the role back');
    await rr.handleReactionRole({ message: message('M2'), emoji: { name: '🔕', id: null } }, { id: 'U' }, true);
    assert(!roles.has(R2), 'reverse: the reaction takes it');
  });

  await test('voice roles: the role is held only while in voice (a given channel or any), never in AFK', async () => {
    const vr = require('../bot/modules/voiceRoles');
    const rules = [{ roleId: R1, channelId: null }, { roleId: R2, channelId: 'VC1' }];
    assert.deepStrictEqual([...vr.wantedRoles(rules, 'VC1', 'AFK')].sort(), [R1, R2].sort());
    assert.deepStrictEqual([...vr.wantedRoles(rules, 'VC2', 'AFK')], [R1]);
    assert.strictEqual(vr.wantedRoles(rules, 'AFK', 'AFK').size, 0);
    assert.strictEqual(vr.wantedRoles(rules, null, 'AFK').size, 0);
    await db.VoiceRole.create({ guildId: G, roleId: R1, channelId: null });
    const roles = new Set();
    const member = { user: { bot: false }, roles: { cache: { has: (id) => roles.has(id) }, add: async (r) => roles.add(r.id), remove: async (r) => roles.delete(r.id) }, guild: { id: G, afkChannelId: 'AFK', roles: { cache: new Map([[R1, { id: R1, editable: true }]]) } } };
    await vr.syncMember(member, 'VC9'); assert(roles.has(R1));
    await vr.syncMember(member, null); assert(!roles.has(R1));
    assert((await post('/voice-roles', { roleId: R2, channelId: '800000000000000002' })).includes('saved'));
    assert((await post('/voice-roles', { roleId: R2, channelId: CH })).includes('badchannel'), 'a text channel is not a voice channel');
  });

  await test('/temprole: the role is given until a time and taken away by the scheduler', async () => {
    const tr = require('../bot/modules/tempRoles');
    const roles = new Set();
    const member = { id: 'T1', roles: { cache: { has: (id) => roles.has(id) }, add: async (r) => roles.add(r.id || r), remove: async (r) => roles.delete(r.id || r) } };
    const guild = { id: G, members: { fetch: async () => member } };
    await tr.give(guild, member, { id: R1 }, 60_000, 'MOD');
    assert(roles.has(R1) && (await db.TempRole.count({ where: { userId: 'T1' } })) === 1);
    await db.TempRole.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: 'T1' } });
    await tr.tick({ guilds: { cache: new Map([[G, guild]]) } });
    assert(!roles.has(R1) && (await db.TempRole.count({ where: { userId: 'T1' } })) === 0);
  });

  await test('reports: filed with a category, limits (same person 12 h, daily), buttons lock after a decision', async () => {
    const reports = require('../bot/modules/reports');
    const { getOrCreateSettings } = require('../bot/modules/leveling');
    const s = await getOrCreateSettings(G); s.reportChannelId = CH; s.reportEnabled = true; s.reportDailyLimit = 2; await s.save();
    const sent = [];
    const channel = { id: CH, send: async (p) => { sent.push(p); return { id: 'LOG' + sent.length }; } };
    const guild = { id: G, channels: { cache: new Map([[CH, channel]]), fetch: async () => channel }, members: { fetch: async () => null } };
    const u = (id) => ({ id, username: id, bot: false });
    let r = await reports.fileReport(guild, { reporter: u('A'), target: u('B'), category: 'spam', reason: 'флуд' });
    assert(r.ok && sent.length === 1 && sent[0].components.length === 2, r.text);
    assert(!(await reports.fileReport(guild, { reporter: u('A'), target: u('B'), category: 'spam' })).ok, 'same person again');
    assert((await reports.fileReport(guild, { reporter: u('A'), target: u('C'), category: 'fraud' })).ok);
    const third = await reports.fileReport(guild, { reporter: u('A'), target: u('D'), category: 'other' });
    assert(!third.ok && /2 жалоб/.test(third.text), third.text);
    assert(!(await reports.fileReport(guild, { reporter: u('A'), target: u('A') })).ok, 'not on yourself');
    const rep = await db.Report.findOne({ where: { targetId: 'B' } });
    const updates = []; const denies = [];
    const i = (perm) => ({ customId: `rep:${rep.id}:ignore`, guildId: G, guild, user: { id: 'MOD' }, member: { permissions: { has: () => perm } }, reply: async (p) => denies.push(p), update: async (p) => updates.push(p) });
    await reports.handleReportComponent(i(false)); assert(denies.length === 1 && updates.length === 0, 'no rights');
    await reports.handleReportComponent(i(true));
    await rep.reload(); assert(rep.status === 'ignored' && rep.handledBy === 'MOD');
    const comps = updates[0].components.map((c) => c.toJSON()); assert(comps.length === 1 && comps[0].components.every((b) => b.disabled), 'locked');
    assert(updates[0].embeds[0].toJSON().fields.some((f) => f.value.includes('закрыл(а) жалобу')));
  });

  await test('reports: a member with reports joining is announced to the moderators', async () => {
    const reports = require('../bot/modules/reports');
    const sent = [];
    const channel = { send: async (p) => sent.push(p) };
    await reports.joinAlert({ id: 'B', user: { tag: 'b#1' }, guild: { id: G, channels: { cache: new Map([[CH, channel]]) } } });
    assert(sent.length === 1 && /Всего жалоб: \*\*1\*\*/.test(sent[0].embeds[0].toJSON().description));
    await reports.joinAlert({ id: 'NOBODY', user: {}, guild: { id: G, channels: { cache: new Map([[CH, channel]]) } } });
    assert.strictEqual(sent.length, 1, 'nothing for a clean member');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
