// Advanced moderation: durations, case numbers, warnings with escalation and expiry, temporary bans,
// /mod subcommands, the automod rules and actions, and the panel pages. Discord is faked.
process.env.DATABASE_PATH = './data/test_moderation.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }],
  getGuildRoles: async () => [{ id: '223456789012345678', name: 'Role' }], getGuild: async (id) => ({ id, name: 'T', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: {}
});
const express = require('express');
const { makeUser, makeInteraction } = require('./mock');

(async () => {
  const db = require('../db'); await db.init();
  const { Warning, ModLog, GuildSettings, sequelize } = db;
  const { parseDuration, formatDuration } = require('../bot/utils/duration');
  const { createCase } = require('../bot/utils/modlog');
  const modSvc = require('../bot/modules/moderation');
  const automod = require('../bot/modules/automod');
  const cmd = require('../bot/commands/moderation/moderation');

  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const text = (i) => JSON.stringify(i._replies);

  // ---- a tiny fake server ----
  const dms = []; let dmFail = false;
  const client = { user: { id: 'BOT' }, users: { send: async (id, t) => { if (dmFail) throw new Error('closed DMs'); dms.push({ id, t }); } }, guilds: { cache: new Map() } };
  const world = { timeouts: [], kicks: [], bans: new Set(), banCalls: [], unbans: [] };
  const members = new Map();
  const G = { id: 'G1', name: 'Сервер', client, ownerId: 'OWNER', roles: { everyone: { id: 'everyone' } }, channels: { fetch: async () => null } };
  G.members = {
    fetch: async (id) => { const m = members.get(id); if (!m) throw new Error('Unknown Member'); return m; },
    ban: async (id, o) => { world.bans.add(id); world.banCalls.push([id, o]); },
    unban: async (id) => { if (!world.bans.has(id)) throw Object.assign(new Error('Unknown Ban'), { code: 10026 }); world.bans.delete(id); world.unbans.push(id); }
  };
  client.guilds.cache.set(G.id, G);
  const mk = (id, extra = {}) => {
    const m = { id, guild: G, user: { id, bot: false, username: 'u' + id }, moderatable: true, kickable: true, bannable: true, permissions: { has: () => false },
      roles: { cache: new Map(), highest: { position: 1, comparePositionTo(o) { return 1 - o.position; } } },
      timeout: async (ms) => { world.timeouts.push([id, ms]); }, kick: async () => { world.kicks.push(id); }, ...extra };
    members.set(id, m); return m;
  };
  mk('V1'); mk('V2'); mk('V3');
  const modMember = { id: 'MOD', guild: G, permissions: { has: () => true }, roles: { highest: { position: 10, comparePositionTo(o) { return 10 - o.position; } } } };
  const run = (sub, options = {}, extra = {}) => { const i = makeInteraction({ guild: G, subcommand: sub, options, user: makeUser('MOD'), member: modMember, ...extra }); return cmd.execute(i).then(() => i); };
  const reset = () => { dms.length = 0; world.timeouts.length = 0; world.kicks.length = 0; world.banCalls.length = 0; world.unbans.length = 0; dmFail = false; };
  await GuildSettings.create({ guildId: 'G1' });
  const setS = (v) => GuildSettings.update(v, { where: { guildId: 'G1' } });

  // ================= durations =================
  await test('durations: 30m, 1h30m, 2д, "3 часа", bare number = minutes; junk is rejected', async () => {
    assert(parseDuration('30m') === 1800000 && parseDuration('1h30m') === 5400000 && parseDuration('2д') === 172800000, 'basic');
    assert(parseDuration('3 часа') === 10800000 && parseDuration('15') === 900000 && parseDuration('1w') === 604800000, 'words');
    assert(parseDuration('abc') === null && parseDuration('0') === null && parseDuration('10x') === null && parseDuration('1h abc') === null && parseDuration('') === null, 'junk');
    assert(formatDuration(90000000) === '1 д 1 ч' && formatDuration(45000) === '45 с', 'format');
  });

  // ================= case numbers =================
  await test('case numbers: 1,2,3... per server, never repeat even for simultaneous actions', async () => {
    const made = await Promise.all(Array.from({ length: 25 }, (_, i) => createCase('GN', { userId: 'u' + i, moderatorId: 'm', action: 'warn', reason: 'x' })));
    const nums = made.map((c) => c.caseNumber).sort((a, b) => a - b);
    assert(nums.join() === Array.from({ length: 25 }, (_, i) => i + 1).join(), nums.join());
    const other = await createCase('GM', { userId: 'u', moderatorId: 'm', action: 'warn', reason: 'x' });
    assert(other.caseNumber === 1, 'another server starts from 1');
  });

  // ================= the command definition =================
  await test('/mod definition fits Discord limits (<=25 subcommands, <=8000 characters, valid names)', async () => {
    const j = cmd.data.toJSON(); let chars = 0; const walk = (o) => { chars += o.name.length + (o.description || '').length; (o.options || []).forEach(walk); };
    walk(j);
    assert(j.options.length <= 25 && chars <= 8000, `${j.options.length} subs, ${chars} chars`);
    const names = j.options.map((o) => o.name);
    for (const n of ['warn', 'unwarn', 'warnings', 'clearwarns', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'note', 'case', 'history', 'reason', 'slowmode', 'lock', 'unlock']) assert(names.includes(n), 'missing ' + n);
    const check = (o) => { assert(/^[\p{L}\p{N}_-]{1,32}$/u.test(o.name) && o.name === o.name.toLowerCase(), 'bad name ' + o.name); assert(o.description.length >= 1 && o.description.length <= 100, `description of ${o.name}: ${o.description.length}`); (o.options || []).forEach(check); };
    j.options.forEach(check);
  });

  // ================= warnings and escalation =================
  await test('warn: counts, DMs the member, writes a numbered case', async () => {
    reset();
    const i = await run('warn', { user: makeUser('V1'), reason: 'флуд' });
    assert(text(i).includes('(1)') && text(i).includes('флуд'), text(i));
    assert(dms.length === 1 && dms[0].id === 'V1' && dms[0].t.includes('флуд') && dms[0].t.includes('Сервер'), JSON.stringify(dms));
    const c = await ModLog.findOne({ where: { guildId: 'G1', action: 'warn', userId: 'V1' } });
    assert(c.caseNumber >= 1, 'case number');
  });
  await test('warn: closed DMs do not break the command; DMs can be switched off', async () => {
    reset(); dmFail = true;
    const i = await run('warn', { user: makeUser('V2'), reason: 'x' }); assert(text(i).includes('предупреждение'), text(i));
    dmFail = false; await setS({ modDmEnabled: false });
    await run('warn', { user: makeUser('V2'), reason: 'y' }); assert(dms.length === 0, 'DM sent although switched off');
    await setS({ modDmEnabled: true });
  });
  await test('escalation: 3 warnings -> mute 60 min, 5 -> temporary ban 1 day (by the bot, with a reason)', async () => {
    reset(); await Warning.destroy({ where: { guildId: 'G1' } });
    await setS({ modWarnThresholds: JSON.stringify([{ count: 3, action: 'mute', minutes: 60 }, { count: 5, action: 'ban', minutes: 1440 }]) });
    await run('warn', { user: makeUser('V3'), reason: 'a' }); await run('warn', { user: makeUser('V3'), reason: 'b' });
    assert(world.timeouts.length === 0, 'too early');
    const third = await run('warn', { user: makeUser('V3'), reason: 'c' });
    assert(world.timeouts.length === 1 && world.timeouts[0][1] === 3600000, JSON.stringify(world.timeouts));
    assert(text(third).includes('Автоматически') && text(third).includes('мут'), text(third));
    const mute = await ModLog.findOne({ where: { guildId: 'G1', action: 'mute', userId: 'V3' } });
    assert(mute.moderatorId === 'BOT' && mute.reason.includes('3 предупреждени') && Number(mute.duration) === 3600000, JSON.stringify(mute));
    await run('warn', { user: makeUser('V3'), reason: 'd' });
    assert(world.banCalls.length === 0, 'ban only at 5');
    const fifth = await run('warn', { user: makeUser('V3'), reason: 'e' });
    assert(world.banCalls.length === 1 && text(fifth).includes('бан'), text(fifth));
    const ban = await ModLog.findOne({ where: { guildId: 'G1', action: 'ban', userId: 'V3' } });
    assert(ban.active === true && ban.expiresAt && Math.abs(new Date(ban.expiresAt) - (Date.now() + 86400000)) < 5000, 'temp ban stored');
    world.bans.delete('V3'); await ban.update({ active: false });
  });
  await test('escalation: kick rule; failure (role too high) is reported, the warning itself stays', async () => {
    reset(); await Warning.destroy({ where: { guildId: 'G1', userId: 'V1' } });
    await setS({ modWarnThresholds: JSON.stringify([{ count: 1, action: 'kick', minutes: 0 }]) });
    const i = await run('warn', { user: makeUser('V1'), reason: 'k' });
    assert(world.kicks.join() === 'V1' && text(i).includes('кик'), text(i));
    members.get('V1').kickable = false; await Warning.destroy({ where: { guildId: 'G1', userId: 'V1' } });
    const j = await run('warn', { user: makeUser('V1'), reason: 'k2' });
    assert(text(j).includes('не удалось') && (await Warning.count({ where: { guildId: 'G1', userId: 'V1' } })) === 1, text(j));
    members.get('V1').kickable = true; await setS({ modWarnThresholds: '[]' });
  });
  await test('escalation: simultaneous warnings never skip or repeat a threshold', async () => {
    reset(); await Warning.destroy({ where: { guildId: 'G1', userId: 'V2' } });
    await setS({ modWarnThresholds: JSON.stringify([{ count: 4, action: 'mute', minutes: 10 }]) });
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => run('warn', { user: makeUser('V2'), reason: 'p' + n })));
    assert(world.timeouts.filter((t) => t[0] === 'V2').length === 1, 'exactly one mute: ' + JSON.stringify(world.timeouts));
    await setS({ modWarnThresholds: '[]' });
  });
  await test('warning expiry: old warnings do not count and are not listed', async () => {
    reset(); await Warning.destroy({ where: { guildId: 'G1', userId: 'V1' } });
    const old = await Warning.create({ guildId: 'G1', userId: 'V1', moderatorId: 'm', reason: 'давно' });
    await sequelize.query('UPDATE warnings SET createdAt = :d WHERE id = :id', { replacements: { d: new Date(Date.now() - 10 * 86400000).toISOString().replace('T', ' ').replace('Z', ' +00:00'), id: old.id } });
    await setS({ modWarnExpireDays: 7 });
    const list = await run('warnings', { user: makeUser('V1') }); assert(text(list).includes('нет действующих'), text(list));
    const w = await run('warn', { user: makeUser('V1'), reason: 'новое' }); assert(text(w).includes('(1)'), text(w));
    await setS({ modWarnExpireDays: 0 });
    const all = await run('warnings', { user: makeUser('V1') }); assert(text(all).includes('(2)') || text(all).includes('давно'), text(all));
  });
  await test('unwarn / clearwarns remove warnings and write cases', async () => {
    reset(); await Warning.destroy({ where: { guildId: 'G1', userId: 'V2' } });
    await run('warn', { user: makeUser('V2'), reason: 'a' }); await run('warn', { user: makeUser('V2'), reason: 'b' });
    const one = await Warning.findOne({ where: { guildId: 'G1', userId: 'V2' } });
    await run('unwarn', { number: one.id }); assert((await Warning.count({ where: { guildId: 'G1', userId: 'V2' } })) === 1, 'unwarn');
    const c = await run('clearwarns', { user: makeUser('V2') }); assert(text(c).includes('снято предупреждений: 1'), text(c));
    assert(text(await run('clearwarns', { user: makeUser('V2') })).includes('нет предупреждений'), 'empty');
  });
  await test('require reason: a punishment without a reason is refused when the server demands it', async () => {
    reset(); await setS({ modRequireReason: true });
    for (const [sub, o] of [['warn', {}], ['kick', {}], ['ban', {}], ['mute', { duration: '5m' }]]) {
      const i = await run(sub, { user: makeUser('V1'), ...o }); assert(text(i).includes('нужно указать причину'), sub + ' ' + text(i));
    }
    assert(world.kicks.length === 0 && world.timeouts.length === 0 && world.banCalls.length === 0, 'nothing happened');
    const ok = await run('warn', { user: makeUser('V1'), reason: 'есть причина' }); assert(text(ok).includes('предупреждение'), text(ok));
    await setS({ modRequireReason: false });
  });

  // ================= mute / kick / ban =================
  await test('mute: duration text, limits, hierarchy', async () => {
    reset();
    const ok = await run('mute', { user: makeUser('V1'), duration: '1h30m', reason: 'шум' });
    assert(world.timeouts[0][1] === 5400000 && text(ok).includes('1 ч 30 мин'), text(ok));
    assert(dms.some((d) => d.t.includes('мут')), 'DM');
    assert(text(await run('mute', { user: makeUser('V1'), duration: 'скоро' })).includes('Не понял срок'), 'junk');
    assert(text(await run('mute', { user: makeUser('V1'), duration: '29d' })).includes('28 дней'), 'limit');
    assert(text(await run('mute', { user: makeUser('V1'), duration: '10m', reason: 'x' }, { member: { ...modMember, roles: { highest: { position: 0, comparePositionTo(o) { return -o.position; } } } } })).includes('не ниже вашей'), 'hierarchy');
    members.get('V1').moderatable = false;
    assert(text(await run('mute', { user: makeUser('V1'), duration: '10m' })).includes('Не могу замутить'), 'cannot');
    members.get('V1').moderatable = true;
  });
  await test('ban with a duration is temporary; without one it is permanent; DM is sent before the ban', async () => {
    reset(); world.bans.clear();
    await run('ban', { user: makeUser('V1'), reason: 'раз', duration: '2h', delete_days: 1 });
    assert(world.banCalls[0][1].deleteMessageSeconds === 86400, 'delete days');
    const t = await ModLog.findOne({ where: { guildId: 'G1', action: 'ban', userId: 'V1', active: true } });
    assert(t && Number(t.duration) === 7200000, 'temporary ban stored');
    assert(dms.some((d) => d.t.includes('2 ч')), 'DM mentions the term');
    await run('ban', { user: makeUser('V1'), reason: 'навсегда' });
    assert((await ModLog.count({ where: { guildId: 'G1', userId: 'V1', action: 'ban', active: true } })) === 0, 'a permanent ban replaces the temporary one');
    const p = await ModLog.findOne({ where: { guildId: 'G1', userId: 'V1', action: 'ban', reason: 'навсегда' } });
    assert(!p.expiresAt, 'permanent');
    assert(text(await run('ban', { user: makeUser('V1'), duration: 'xx' })).includes('Не понял срок'), 'bad duration');
  });
  await test('scheduler: an expired temporary ban is lifted once, recorded as an unban by the bot', async () => {
    reset(); world.bans.add('V2');
    const c = await createCase('G1', { userId: 'V2', moderatorId: 'MOD', action: 'ban', reason: 'врем', duration: 1000, expiresAt: new Date(Date.now() - 1000), active: true });
    const fresh = await createCase('G1', { userId: 'V3', moderatorId: 'MOD', action: 'ban', reason: 'ещё', duration: 99999999, expiresAt: new Date(Date.now() + 99999999), active: true });
    assert((await modSvc.liftExpiredBans(client)) === 1 && world.unbans.join() === 'V2', 'lifted ' + world.unbans);
    assert((await ModLog.findByPk(c.id)).active === false && (await ModLog.findByPk(fresh.id)).active === true, 'flags');
    const un = await ModLog.findOne({ where: { guildId: 'G1', action: 'unban', userId: 'V2' }, order: [['id', 'DESC']] });
    assert(un.moderatorId === 'BOT' && un.reason.includes(`#${c.caseNumber}`), JSON.stringify(un));
    assert((await modSvc.liftExpiredBans(client)) === 0, 'not twice');
    await fresh.update({ active: false });
  });
  await test('scheduler: already unbanned by hand is fine; a server the bot left is retried later', async () => {
    reset();
    const a = await createCase('G1', { userId: 'V9', moderatorId: 'MOD', action: 'ban', reason: 'r', duration: 1, expiresAt: new Date(Date.now() - 5), active: true });
    assert((await modSvc.liftExpiredBans(client)) === 1 && (await ModLog.findByPk(a.id)).active === false, 'unknown ban tolerated');
    const b = await createCase('GONE', { userId: 'V9', moderatorId: 'MOD', action: 'ban', reason: 'r', duration: 1, expiresAt: new Date(Date.now() - 5), active: true });
    assert((await modSvc.liftExpiredBans(client)) === 0 && (await ModLog.findByPk(b.id)).active === true, 'kept for later');
    await b.update({ active: false });
  });
  await test('unban by hand cancels the pending temporary ban', async () => {
    reset(); world.bans.add('V4');
    const c = await createCase('G1', { userId: 'V4', moderatorId: 'MOD', action: 'ban', reason: 'r', duration: 9e7, expiresAt: new Date(Date.now() + 9e7), active: true });
    const i = await run('unban', { id: '123456789012345678' }); assert(text(i).includes('не найден'), 'unknown');
    world.bans.add('123456789012345678'); await run('unban', { id: '123456789012345678' });
    world.bans.add('V4'); const m = await modSvc.unbanUser(G, 'V4', { moderatorId: 'MOD' });
    assert((await ModLog.findByPk(c.id)).active === false && m.action === 'unban', 'cancelled');
  });

  // ================= notes and cases =================
  await test('note / case / history / reason', async () => {
    reset();
    const n = await run('note', { user: makeUser('V1'), text: 'подозрительный, следить' });
    assert(text(n).includes('Заметка') && n.replied, text(n)); assert(dms.length === 0, 'notes are private: no DM');
    const note = await ModLog.findOne({ where: { guildId: 'G1', action: 'note', userId: 'V1' } });
    const c = await run('case', { number: note.caseNumber }); assert(text(c).includes('подозрительный') && text(c).includes('Заметка'), text(c));
    assert(text(await run('case', { number: 99999 })).includes('не найдено'), 'unknown');
    const h = await run('history', { user: makeUser('V1') }); assert(text(h).includes(`#${note.caseNumber}`) && text(h).includes('Бан'), text(h));
    assert(text(await run('history', { user: makeUser('NOBODY') })).includes('пусто'), 'empty history');
    await run('reason', { number: note.caseNumber, text: 'ложная тревога' });
    assert((await ModLog.findByPk(note.id)).reason === 'ложная тревога', 'reason edited');
    assert(text(await run('reason', { number: 99999, text: 'x' })).includes('не найдено'), 'unknown case');
  });

  // ================= clear / channels =================
  await test('clear: with a user only that member\'s messages are removed', async () => {
    const msgs = new Map([['1', { id: '1', author: { id: 'A' } }], ['2', { id: '2', author: { id: 'B' } }], ['3', { id: '3', author: { id: 'A' } }], ['4', { id: '4', author: { id: 'A' } }]]);
    let removed = null;
    const channel = { id: 'C1', name: 'general', messages: { fetch: async () => msgs }, bulkDelete: async (x) => { removed = x; return { size: x.length }; } };
    const i = await run('clear', { count: 2, user: makeUser('A') }, { channel });
    assert(removed.map((m) => m.id).join() === '1,3' && text(i).includes('Удалено 2'), JSON.stringify(removed) + text(i));
    const i2 = await run('clear', { count: 10 }, { channel: { ...channel, bulkDelete: async (n) => ({ size: n }) } }); assert(text(i2).includes('Удалено 10'), text(i2));
    const none = await run('clear', { count: 5, user: makeUser('ZZZ') }, { channel }); assert(text(none).includes('Удалено 0'), text(none));
  });
  await test('clear filters: bots, text, links, files (together they must all match)', async () => {
    const mk2 = (id, o) => [id, { id, author: { id: 'A', bot: false }, content: '', attachments: new Map(), ...o }];
    const msgs = new Map([mk2('1', { author: { id: 'BOTX', bot: true }, content: 'hi' }), mk2('2', { content: 'Купи тут https://x.ru' }), mk2('3', { content: 'привет' }), mk2('4', { attachments: new Map([['f', 1]]) }), mk2('5', { content: 'ПРИВЕТ всем https://y.ru' })]);
    let removed = null;
    const channel = { id: 'C1', name: 'general', messages: { fetch: async () => msgs }, bulkDelete: async (x) => { removed = x; return { size: x.length }; } };
    const ids = () => removed.map((m) => m.id).join();
    await run('clear', { count: 50, bots: true }, { channel }); assert(ids() === '1', 'bots ' + ids());
    await run('clear', { count: 50, links: true }, { channel }); assert(ids() === '2,5', 'links ' + ids());
    await run('clear', { count: 50, attachments: true }, { channel }); assert(ids() === '4', 'files ' + ids());
    await run('clear', { count: 50, contains: 'привет' }, { channel }); assert(ids() === '3,5', 'text ' + ids());
    await run('clear', { count: 50, contains: 'привет', links: true }, { channel }); assert(ids() === '5', 'text+links ' + ids());
    await run('clear', { count: 1, links: true }, { channel }); assert(ids() === '2', 'count limit ' + ids());
  });
  await test('slowmode, lock and unlock change the channel; they need Manage Channels', async () => {
    const calls = []; const channel = { id: 'C9', name: 'x', setRateLimitPerUser: async (s) => calls.push(['slow', s]), permissionOverwrites: { edit: async (role, perms) => calls.push(['perm', role.id, perms]) } };
    assert(text(await run('slowmode', { seconds: 30 }, { channel })).includes('30 с'), 'slow');
    assert(text(await run('slowmode', { seconds: 0 }, { channel })).includes('выключен'), 'off');
    assert(text(await run('lock', { reason: 'рейд' }, { channel })).includes('закрыт'), 'lock');
    assert(text(await run('unlock', {}, { channel })).includes('открыт'), 'unlock');
    assert(JSON.stringify(calls) === JSON.stringify([['slow', 30], ['slow', 0], ['perm', 'everyone', { SendMessages: false }], ['perm', 'everyone', { SendMessages: null }]]), JSON.stringify(calls));
    const weak = { ...modMember, permissions: { has: (f) => f !== require('discord.js').PermissionsBitField.Flags.ManageChannels } };
    assert(text(await run('lock', {}, { channel, member: weak })).includes('Manage Channels'), 'permission');
  });

  // ================= automod =================
  const notices = []; let deleted = 0;
  const msg = (content, uid = 'V1', extra = {}) => ({ content, guild: G, guildId: 'G1', channelId: 'C1', client, author: { id: uid, bot: false, username: 'u' + uid }, member: members.get(uid),
    delete: async () => { deleted++; }, channel: { send: async (t) => { notices.push(t); return { delete: async () => {} }; } }, ...extra });
  const base = { automodEnabled: true, automodBannedWords: '[]', automodBlockInvites: false, automodAntiSpam: false, automodSpamMessages: 5, automodSpamSeconds: 7 };
  await test('automod rules: mentions, caps, emoji, links with a whitelist, duplicates', async () => {
    const ev = (s, c, uid = 'V1') => automod.evaluateMessage({ ...base, ...s }, msg(c, uid));
    assert(await ev({ automodMentionLimit: 3 }, '<@1> <@2> <@3> <@4>') && !(await ev({ automodMentionLimit: 3 }, '<@1> <@1> <@1> <@1> <@2>')), 'mentions: unique ones count');
    assert(await ev({ automodMentionLimit: 2 }, '@everyone @here <@1>'), 'everyone counts');
    assert(await ev({ automodCapsPercent: 70 }, 'ПРИВЕТ ВСЕМ КАК ДЕЛА') && !(await ev({ automodCapsPercent: 70 }, 'Привет всем, как дела')) && !(await ev({ automodCapsPercent: 70 }, 'ОК')), 'caps (short messages are skipped)');
    assert(await ev({ automodEmojiLimit: 3 }, '😀😀😀😀') && await ev({ automodEmojiLimit: 1 }, '<:a:123456789> <a:b:987654321>') && !(await ev({ automodEmojiLimit: 3 }, '😀 привет 😀')), 'emoji');
    const links = { automodBlockLinks: true, automodLinkWhitelist: JSON.stringify(['youtube.com']) };
    assert(await ev(links, 'смотри https://evil.com/x') && await ev(links, 'www.evil.com'), 'blocked');
    assert(!(await ev(links, 'https://www.youtube.com/watch?v=1')) && !(await ev(links, 'https://m.youtube.com/x')) && !(await ev(links, 'без ссылок')), 'whitelist and plain text');
    assert(await ev(links, 'https://youtube.com.evil.com/'), 'a lookalike domain is not the whitelisted site');
    const dup = { automodDuplicates: true };
    assert(!(await ev(dup, 'одно и то же', 'D1')) && !(await ev(dup, 'Одно и то же', 'D1')) && await ev(dup, 'одно и то же', 'D1'), 'third copy');
    assert(!(await ev(dup, 'одно и то же', 'D1')), 'the count starts again after a punishment');
    assert(!(await ev({ ...dup }, 'ab', 'D2')) && !(await ev(dup, 'ab', 'D2')) && !(await ev(dup, 'ab', 'D2')), 'very short messages are not duplicates');
  });
  await test('automod: spam counter restarts after a punishment (one punishment per burst)', async () => {
    const s = { ...base, automodAntiSpam: true, automodSpamMessages: 3, automodSpamSeconds: 30 };
    const hits = []; for (let i = 0; i < 8; i++) hits.push(!!(await automod.evaluateMessage(s, msg('s' + i, 'SP'))));
    assert(hits.join() === 'false,false,false,true,false,false,false,true', hits.join());
  });
  await test('automod exceptions: ignored channel, ignored role, moderators', async () => {
    const s = { ...base, automodBannedWords: JSON.stringify(['плохо']), automodIgnoredChannels: JSON.stringify(['C-OK']), automodIgnoredRoles: JSON.stringify(['R-OK']) };
    assert(await automod.evaluateMessage(s, msg('плохо')), 'normal channel is checked');
    assert(!(await automod.evaluateMessage(s, msg('плохо', 'V1', { channelId: 'C-OK' }))), 'ignored channel');
    const withRole = mk('VR', { roles: { cache: new Map([['R-OK', {}]]), highest: { position: 1 } } });
    assert(!(await automod.evaluateMessage(s, msg('плохо', 'VR'))) && withRole, 'ignored role');
    const mod2 = mk('MM', { permissions: { has: (f) => f === 'ManageMessages' } });
    assert(!(await automod.evaluateMessage(s, msg('плохо', 'MM'))) && mod2, 'moderator');
    assert(!(await automod.evaluateMessage({ ...s, automodEnabled: false }, msg('плохо'))), 'switched off');
  });
  await test('automod action "delete": deletes, writes an automod case by the bot, posts a short notice', async () => {
    reset(); deleted = 0; notices.length = 0; await setS({ automodAction: 'delete' });
    const s = await GuildSettings.findByPk('G1'); const before = await ModLog.count({ where: { guildId: 'G1', action: 'automod' } });
    await automod.handleViolation(s, msg('x'), 'запрещённое слово');
    assert(deleted === 1 && notices[0].includes('запрещённое слово') && !notices[0].includes('Выдано'), notices[0]);
    assert((await ModLog.count({ where: { guildId: 'G1', action: 'automod' } })) === before + 1 && !world.timeouts.length, 'case only');
  });
  await test('automod action "warn": a real warning from the bot, escalation applies, only one per burst', async () => {
    reset(); deleted = 0; notices.length = 0; await Warning.destroy({ where: { guildId: 'G1', userId: 'AW' } }); mk('AW');
    await setS({ automodAction: 'warn', modWarnThresholds: JSON.stringify([{ count: 2, action: 'mute', minutes: 5 }]) });
    const s = await GuildSettings.findByPk('G1');
    await automod.handleViolation(s, msg('a', 'AW'), 'спам'); await automod.handleViolation(s, msg('b', 'AW'), 'спам');
    assert(deleted === 2, 'both messages deleted');
    assert((await Warning.count({ where: { guildId: 'G1', userId: 'AW' } })) === 1, 'second violation in the cooldown is only deleted');
    const w = await Warning.findOne({ where: { guildId: 'G1', userId: 'AW' } }); assert(w.moderatorId === 'BOT' && w.reason.startsWith('Автомодерация'), JSON.stringify(w));
    assert(notices[0].includes('предупреждение (1)') && world.timeouts.length === 0, notices[0]);
    await setS({ automodAction: 'delete', modWarnThresholds: '[]' });
  });
  await test('automod action "mute": timeout for the set minutes; if it fails the violation is still recorded', async () => {
    reset(); deleted = 0; notices.length = 0; mk('AM'); await setS({ automodAction: 'mute', automodMuteMinutes: 15 });
    const s = await GuildSettings.findByPk('G1');
    await automod.handleViolation(s, msg('a', 'AM'), 'caps'); assert(world.timeouts[0][0] === 'AM' && world.timeouts[0][1] === 900000 && notices[0].includes('мут на 15 мин'), JSON.stringify(world.timeouts) + notices[0]);
    mk('AM2', { moderatable: false }); const before = await ModLog.count({ where: { guildId: 'G1', action: 'automod' } });
    await automod.handleViolation(s, msg('a', 'AM2'), 'caps');
    assert(deleted === 2 && (await ModLog.count({ where: { guildId: 'G1', action: 'automod' } })) === before + 1 && !notices[1].includes('Выдано'), 'fallback ' + notices[1]);
    await setS({ automodAction: 'delete' });
  });

  // ================= the panel =================
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base2 = `http://127.0.0.1:${server.address().port}/dashboard/G1`;
  const post = (p, body) => fetch(base2 + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const S = () => GuildSettings.findByPk('G1');
  await test('panel: moderation page shows case numbers, terms and the warning rules', async () => {
    const r = await fetch(base2 + '/moderation'); const html = await r.text();
    assert(r.status === 200 && html.includes('Правила наказаний') && html.includes('>№</th>') && /#\d+/.test(html), html.slice(0, 300));
    assert((await fetch(base2 + '/moderation?action=note')).status === 200, 'note filter');
  });
  await test('panel: warning rules are saved, cleaned and sorted', async () => {
    const body = new URLSearchParams(); body.set('modDmEnabled', 'on');
    [['5', 'ban', '0'], ['3', 'mute', '60'], ['0', 'mute', '9'], ['3', 'kick', '77'], ['9', 'hack', '5'], ['7', 'mute', '999999']].forEach(([c, a, m]) => { body.append('thrCount', c); body.append('thrAction', a); body.append('thrMinutes', m); });
    body.set('modWarnExpireDays', '30'); body.set('modRequireReason', 'on');
    const r = await fetch(base2 + '/moderation/rules', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    assert(r.status === 302, 'status ' + r.status);
    const s = await S(); const rules = modSvc.parseThresholds(s.modWarnThresholds);
    assert(s.modDmEnabled && s.modRequireReason && s.modWarnExpireDays === 30, 'flags');
    assert(JSON.stringify(rules.map((t) => [t.count, t.action, t.minutes])) === JSON.stringify([[3, 'kick', 0], [5, 'ban', 0], [7, 'mute', 40320], [9, 'mute', 5]]), JSON.stringify(rules));
    const one = await post('/moderation/rules', { thrCount: '2', thrAction: 'mute', thrMinutes: '0' }); assert(one.status === 302, 'single row works');
    assert(modSvc.parseThresholds((await S()).modWarnThresholds)[0].minutes === 1, 'a mute needs at least a minute');
    await post('/moderation/rules', {}); const s2 = await S(); assert(!s2.modDmEnabled && !s2.modRequireReason && modSvc.parseThresholds(s2.modWarnThresholds).length === 0, 'unchecked boxes switch off, no rows clear the rules');
  });
  await test('panel: the channels form does not touch the rules', async () => {
    await post('/moderation/rules', { modDmEnabled: 'on', modWarnExpireDays: '5' });
    await post('/moderation', { modLogChannelId: '123456789012345678' });
    const s = await S(); assert(s.modLogChannelId === '123456789012345678' && s.modDmEnabled === true && s.modWarnExpireDays === 5, 'rules kept');
  });
  await test('panel: automod page renders and saves the new rules, action and exceptions', async () => {
    assert((await fetch(base2 + '/automod')).status === 200, 'page');
    const body = new URLSearchParams(); body.set('automodEnabled', 'on'); body.set('automodBlockLinks', 'on'); body.set('automodDuplicates', 'on');
    body.set('automodMentionLimit', '4'); body.set('automodEmojiLimit', '9'); body.set('automodCapsPercent', '60'); body.set('automodCapsMinLength', '12');
    body.set('linkWhitelist', 'https://www.YouTube.com/watch\nyoutu.be\n\n'); body.set('bannedWords', 'Плохо\nплохо\nещё');
    body.set('automodAction', 'mute'); body.set('automodMuteMinutes', '99999');
    body.append('ignoredChannels', '123456789012345678'); body.append('ignoredChannels', 'not-an-id'); body.append('ignoredRoles', '223456789012345678');
    const r = await fetch(base2 + '/automod', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    assert(r.status === 302, 'status ' + r.status);
    const s = await S();
    assert(s.automodBlockLinks && s.automodDuplicates && s.automodMentionLimit === 4 && s.automodEmojiLimit === 9 && s.automodCapsPercent === 60 && s.automodCapsMinLength === 12, 'numbers');
    assert(s.automodLinkWhitelist === JSON.stringify(['youtube.com', 'youtu.be']) && s.automodBannedWords === JSON.stringify(['плохо', 'ещё']), s.automodLinkWhitelist + s.automodBannedWords);
    assert(s.automodAction === 'mute' && s.automodMuteMinutes === 40320, 'action ' + s.automodMuteMinutes);
    assert(s.automodIgnoredChannels === JSON.stringify(['123456789012345678']) && s.automodIgnoredRoles === JSON.stringify(['223456789012345678']), 'exceptions');
    const html = await (await fetch(base2 + '/automod')).text();
    assert(html.includes('youtube.com') && html.includes('selected'), 'values shown on the page');
    await post('/automod', { automodAction: 'explode' }); assert((await S()).automodAction === 'delete', 'unknown action falls back to delete');
  });
  await test('panel: the save bar script waits for the page (the forms come after the sidebar), and every table can scroll sideways', async () => {
    const html = await (await fetch(base2 + '/automod')).text();
    assert(/DOMContentLoaded[\s\S]{0,80}\n\s+var bar = document\.getElementById\('saveBar'\)/.test(html), 'save bar script must run after the forms exist');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'web', 'views', 'dashboard'))) {
      const t = fs.readFileSync(path.join(__dirname, '..', 'web', 'views', 'dashboard', f), 'utf8');
      assert(!t.includes('<table') || t.includes('table-scroll'), f + ': a table without a scroll wrapper breaks the phone layout');
    }
  });
  await test('panel: the overview shows action names in Russian, including notes and automod', async () => {
    const html = await (await fetch(base2)).text();
    assert(html.includes('Заметка') || !html.includes('>note<'), 'note is not translated');
    assert(!/>(note|automod|warn|unwarn|kick|ban|mute)<\/span><span class="person"/.test(html), 'raw action name in the overview');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
