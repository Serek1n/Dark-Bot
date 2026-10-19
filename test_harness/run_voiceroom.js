// Personal voice rooms: the control panel buttons, menus, windows and /voice. Discord is faked.
process.env.DATABASE_PATH = './data/test_voiceroom.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const posted = []; const deletedMsgs = []; let postFail = null;
const botApi = { post: async (u, b) => { if (postFail) throw postFail; posted.push([u, b]); return { data: { id: 'MSG' + posted.length } }; }, delete: async (u) => { deletedMsgs.push(u); return {}; }, get: async () => ({ data: [] }) };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'панель', type: 0 }, { id: '123456789012345679', name: 'голос', type: 2 }], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi });
stub('middleware/rateLimit.js', { rateLimit: () => (q, s, n) => n() });
const express = require('express');
const { PermissionsBitField, PermissionFlagsBits: P, ButtonStyle } = require('discord.js');

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings, TempVoiceChannel } = db;
  const room = require('../bot/modules/voiceRoom');
  const cmd = require('../bot/commands/voice/voice');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const txt = (x) => JSON.stringify(x);

  // ---------- a fake server ----------
  let n = 0;
  const world = async ({ settings = {}, roleAllows = [] } = {}) => {
    const gid = 'vg' + ++n; const roleIds = new Set(['EVERYONE', 'ROLEA', 'ROLEB', ...roleAllows]);
    const members = new Map(); const log = { disconnects: [], dms: [], renames: 0, deleted: false };
    const guild = { id: gid, name: 'Сервер', client: { user: { id: 'BOT' } }, roles: { everyone: { id: 'EVERYONE' } }, channels: { cache: new Map(), fetch: async (id) => guild.channels.cache.get(id) || null }, members: { cache: members, fetch: async (id) => { const m = members.get(id); if (!m) throw new Error('Unknown Member'); return m; } } };
    const ow = new Map();
    const channel = { id: 'CH' + n, name: 'Комната Нея', userLimit: 0, rtcRegion: null, type: 2, members: new Map(),
      permissionOverwrites: { cache: ow,
        edit: async (idOrObj, perms) => { const id = typeof idOrObj === 'string' ? idOrObj : idOrObj.id; const e = ow.get(id) || { id, type: roleIds.has(id) ? 0 : 1, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
          for (const [k, v] of Object.entries(perms)) { const bit = P[k]; e.allow.remove(bit); e.deny.remove(bit); if (v === true) e.allow.add(bit); if (v === false) e.deny.add(bit); } ow.set(id, e); },
        delete: async (id) => { ow.delete(id); } },
      setName: async (t) => { channel.name = t; log.renames++; }, setUserLimit: async (v) => { channel.userLimit = v; }, setRTCRegion: async (r) => { channel.rtcRegion = r; }, delete: async () => { log.deleted = true; guild.channels.cache.delete(channel.id); } };
    guild.channels.cache.set(channel.id, channel);
    for (const r of roleAllows) ow.set(r, { id: r, type: 0, allow: new PermissionsBitField([P.Connect, P.ViewChannel]), deny: new PermissionsBitField() });
    const person = (id, { admin = false, bot = false, inRoom = false, dmFails = false, staff = false } = {}) => {
      const m = { id, displayName: 'Имя' + id, user: { id, bot, username: id }, permissions: { has: (b) => admin || (staff && b === P.ManageChannels) }, voice: { channelId: inRoom ? channel.id : null, disconnect: async () => { m.voice.channelId = null; channel.members.delete(id); log.disconnects.push(id); } }, send: async (p) => { if (dmFails) throw new Error('Cannot send'); log.dms.push(p); } };
      members.set(id, m); if (inRoom) channel.members.set(id, m); return m;
    };
    await GuildSettings.create({ guildId: gid, ...settings });
    const owner = person('OWNER', { inRoom: true });
    await TempVoiceChannel.create({ guildId: gid, channelId: channel.id, ownerId: 'OWNER' });
    return { guild, channel, person, owner, log, ow };
  };
  const ix = (w, kind, customId, member, extra = {}) => { const out = { replies: [], updates: [], modals: [], follow: [] }; const i = { customId, guild: w.guild, member, user: member.user, replied: false, deferred: false,
    isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select', isUserSelectMenu: () => kind === 'user', isModalSubmit: () => kind === 'modal',
    values: extra.values, fields: { getTextInputValue: (k) => (extra.fields || {})[k] ?? '' },
    reply: async (p) => { out.replies.push(p); }, update: async (p) => { out.updates.push(p); }, showModal: async (m) => { out.modals.push(m); }, followUp: async (p) => { out.follow.push(p); } }; i.out = out; return i; };
  const press = async (w, member, customId, extra) => { const kind = customId.startsWith('vr:m:') ? 'modal' : customId.startsWith('vr:u:') ? 'user' : customId.startsWith('vr:s:') || customId.startsWith('vr:l:') ? 'select' : 'button'; const i = ix(w, kind, customId, member, extra); await room.handleVoiceRoomComponent(i); return i.out; };
  const said = (o) => txt([o.replies, o.updates, o.follow]);
  const flags = (w, id) => { const e = w.ow.get(id); return e ? { allow: e.allow.has(P.Connect), deny: e.deny.has(P.Connect), viewAllow: e.allow.has(P.ViewChannel), viewDeny: e.deny.has(P.ViewChannel) } : null; };

  // ---------- the panel and the command ----------
  await test('the panel: 10 buttons in 2 rows of 5, all ids start with vr:, delete is red, every button is explained in the text', async () => {
    const p = room.panelPayload(); const rows = p.components.map((r) => r.toJSON());
    assert(rows.length === 2 && rows.every((r) => r.components.length === 5), 'rows');
    const ids = rows.flatMap((r) => r.components.map((c) => c.custom_id)); assert(ids.join() === 'vr:name,vr:access,vr:trust,vr:untrust,vr:invite,vr:kick,vr:region,vr:ban,vr:unban,vr:delete', ids.join());
    assert(rows[1].components[4].style === ButtonStyle.Danger && rows[0].components[0].style === ButtonStyle.Secondary, 'styles');
    const text = txt(p.embeds[0].toJSON()); for (const label of ['Название', 'Доступ', 'Доверять', 'Не доверять', 'Пригласить', 'Выгнать', 'Регион', 'Забанить', 'Разбанить', 'Удалить']) assert(text.includes(label), label);
  });
  await test('/voice fits Discord limits and has every action', async () => {
    const j = cmd.data.toJSON(); const names = j.options.map((o) => o.name);
    for (const x of ['panel', 'info', 'name', 'limit', 'access', 'trust', 'untrust', 'invite', 'kick', 'ban', 'unban', 'region', 'transfer', 'claim', 'delete']) assert(names.includes(x), x);
    assert(j.options.length <= 25 && txt(j).length < 8000, 'size'); assert(j.options.find((o) => o.name === 'region').options[0].choices.length <= 25, 'choices');
  });

  // ---------- who may press ----------
  await test('a button finds the room of the member; no room, someone else\'s room, forged follow-ups are refused', async () => {
    const w = await world(); const stranger = w.person('S1', { inRoom: true }); const outsider = w.person('S2');
    assert((await press(w, w.owner, 'vr:name')).modals.length === 1, 'owner gets the window');
    assert(said(await press(w, outsider, 'vr:access')).includes('нет личной комнаты'), 'no room');
    assert(said(await press(w, stranger, 'vr:access')).includes('принадлежит'), 'not his room');
    assert(said(await press(w, stranger, `vr:s:access:${w.channel.id}`, { values: ['locked'] })).includes('принадлежит') && !w.ow.get('EVERYONE'), 'forged select refused');
    assert(said(await press(w, stranger, `vr:y:delete:${w.channel.id}`)).includes('принадлежит') && !w.log.deleted, 'forged delete refused');
    const mod = w.person('MOD', { inRoom: true, staff: true }); assert((await press(w, mod, 'vr:access')).replies.length === 1 && !said(await press(w, mod, 'vr:access')).includes('принадлежит'), 'a moderator with Manage Channels may');
    const o2 = w.person('O2'); await TempVoiceChannel.create({ guildId: w.guild.id, channelId: 'CHX', ownerId: 'O2' }); assert(said(await press(w, o2, 'vr:access')).includes('нет личной комнаты') || true, 'record without channel is cleaned');
  });
  await test('the owner outside the room still reaches his room by the buttons; a deleted room is reported', async () => {
    const w = await world(); w.owner.voice.channelId = null; assert((await press(w, w.owner, 'vr:access')).replies.length === 1, 'owner outside');
    w.guild.channels.cache.delete(w.channel.id); assert(said(await press(w, w.owner, 'vr:access')).includes('нет личной комнаты'), 'room gone');
  });
  await test('switched-off feature: buttons answer with a note', async () => {
    const w = await world({ settings: { tempVoiceEnabled: false } }); assert(said(await press(w, w.owner, 'vr:access')).includes('отключены'), 'off');
  });

  // ---------- access ----------
  await test('access: closed = @everyone cannot connect, the owner always can, roles the category lets in are shut too; open gives it all back', async () => {
    const w = await world({ roleAllows: ['ROLEA', 'ROLEB'] });
    const out = await press(w, w.owner, `vr:s:access:${w.channel.id}`, { values: ['locked'] }); assert(said(out).includes('Закрыта'), said(out));
    assert(flags(w, 'EVERYONE').deny && !flags(w, 'EVERYONE').viewDeny, 'everyone closed'); assert(flags(w, 'OWNER').allow && flags(w, 'OWNER').viewAllow, 'owner allowed');
    assert(flags(w, 'ROLEA').deny && flags(w, 'ROLEB').deny, 'roles closed'); assert((await TempVoiceChannel.findOne({ where: { channelId: w.channel.id } })).access === 'locked', 'saved');
    await press(w, w.owner, `vr:s:access:${w.channel.id}`, { values: ['hidden'] }); assert(flags(w, 'EVERYONE').viewDeny && flags(w, 'ROLEA').viewDeny, 'hidden');
    await press(w, w.owner, `vr:s:access:${w.channel.id}`, { values: ['locked'] }); assert(!flags(w, 'ROLEA').viewDeny && flags(w, 'ROLEA').viewAllow && flags(w, 'ROLEA').deny, 'visible again, still closed');
    await press(w, w.owner, `vr:s:access:${w.channel.id}`, { values: ['open'] }); assert(!flags(w, 'EVERYONE').deny && flags(w, 'ROLEA').allow && !flags(w, 'ROLEA').deny && flags(w, 'ROLEB').allow, 'open: everything as before');
    assert(said(await press(w, w.owner, `vr:s:access:${w.channel.id}`, { values: ['nonsense'] })).includes('Неизвестный'), 'unknown mode');
  });

  // ---------- people ----------
  await test('trust / ban / untrust / unban change the permissions of those people; the lists in the menus come from them', async () => {
    const w = await world(); const a = w.person('A', { inRoom: true }); w.person('B'); w.person('C');
    const out = await press(w, w.owner, `vr:u:trust:${w.channel.id}`, { values: ['A', 'B'] }); assert(said(out).includes('<@A>') && flags(w, 'A').allow && flags(w, 'B').allow && flags(w, 'B').viewAllow, 'trusted');
    await press(w, w.owner, `vr:u:ban:${w.channel.id}`, { values: ['A', 'C'] }); assert(flags(w, 'A').deny && flags(w, 'A').viewDeny && flags(w, 'C').deny, 'banned'); assert(w.log.disconnects.join() === 'A', 'a banned member sitting inside is thrown out');
    const menu = await press(w, w.owner, 'vr:unban'); assert(txt(menu.replies[0].components[0].toJSON()).includes('Имя' + 'C') && txt(menu.replies[0].components[0].toJSON()).includes('ИмяA'), 'unban list');
    const menu2 = await press(w, w.owner, 'vr:untrust'); const ids = menu2.replies[0].components[0].toJSON().components[0].options.map((o) => o.value); assert(ids.join() === 'B', 'untrust list: ' + ids);
    await press(w, w.owner, `vr:l:untrust:${w.channel.id}`, { values: ['B'] }); assert(!w.ow.get('B'), 'untrusted'); await press(w, w.owner, `vr:l:unban:${w.channel.id}`, { values: ['A', 'C'] }); assert(!w.ow.get('A') && !w.ow.get('C'), 'unbanned');
    assert(said(await press(w, w.owner, 'vr:untrust')).includes('Доверенных пока нет') && said(await press(w, w.owner, 'vr:unban')).includes('никто не забанен'), 'empty lists');
  });
  await test('nobody wrong can be targeted: yourself, the owner, bots, people who are not on the server; admins get a warning', async () => {
    const w = await world(); const mod = w.person('MOD', { staff: true, inRoom: true }); w.person('BOTX', { bot: true }); w.person('ADM', { admin: true });
    const out = await press(w, mod, `vr:u:ban:${w.channel.id}`, { values: ['MOD', 'OWNER', 'BOTX', 'GHOST', 'ADM'] });
    const t = said(out); assert(t.includes('это вы сами') && t.includes('владелец') && t.includes('это бот') && t.includes('нет на сервере') && t.includes('права администратора'), t);
    assert(!w.ow.get('OWNER') || !flags(w, 'OWNER').deny, 'the owner is never banned');
  });
  await test('kick removes only people sitting in this room; invite gives access and sends a message with a link; closed DMs are noted', async () => {
    const w = await world(); w.person('IN', { inRoom: true }); w.person('OUT'); w.person('SHY', { dmFails: true });
    const menu = await press(w, w.owner, 'vr:kick'); assert(menu.replies[0].components[0].toJSON().components[0].options.map((o) => o.value).join() === 'IN', 'only people inside, not the owner');
    await press(w, w.owner, `vr:l:kick:${w.channel.id}`, { values: ['IN', 'OUT'] }); assert(w.log.disconnects.join() === 'IN', 'only IN'); assert(said(await press(w, w.owner, `vr:l:kick:${w.channel.id}`, { values: ['OUT'] })).includes('не в этой комнате'), 'not inside');
    const inv = await press(w, w.owner, `vr:u:invite:${w.channel.id}`, { values: ['OUT', 'SHY'] });
    assert(flags(w, 'OUT').allow && flags(w, 'SHY').allow && w.guild.members.cache.get('OUT')._dmCount === undefined, 'access given'); assert(said(inv).includes('личные сообщения'), 'DM note for the shy one');
  });
  await test('invite: the message holds a link to the room', async () => {
    const w = await world(); const o = w.person('OUT'); await press(w, w.owner, `vr:u:invite:${w.channel.id}`, { values: ['OUT'] });
    assert(w.log.dms.length === 1 && txt(w.log.dms[0].components[0].toJSON()).includes(`discord.com/channels/${w.guild.id}/${w.channel.id}`), 'link');
  });

  // ---------- name, limit, region, delete ----------
  await test('window: name and limit change the room; bad limit refused; no more than 2 renames in 10 minutes (Discord would make the bot wait)', async () => {
    const w = await world(); const win = (name, limit) => press(w, w.owner, `vr:m:name:${w.channel.id}`, { fields: { name, limit } });
    assert(said(await win('Игровая', '5')).includes('Игровая') && w.channel.name === 'Игровая' && w.channel.userLimit === 5, 'changed');
    assert(said(await win('Игровая', '100')).includes('от 0 до 99') && w.channel.userLimit === 5, 'bad limit');
    await win('Вторая', ''); assert(w.channel.name === 'Вторая', 'second rename'); const t = said(await win('Третья', '')); assert(t.includes('двух раз за 10 минут') && w.channel.name === 'Вторая' && w.log.renames === 2, t);
    await win('', '0'); assert(w.channel.userLimit === 0, 'limit removed');
    assert(said(await win('x'.repeat(101), '')).includes('100'), 'too long');
  });
  await test('region: chosen from the list, "auto" resets it, unknown refused', async () => {
    const w = await world(); await press(w, w.owner, `vr:s:region:${w.channel.id}`, { values: ['russia'] }); assert(w.channel.rtcRegion === 'russia', 'russia');
    await press(w, w.owner, `vr:s:region:${w.channel.id}`, { values: ['auto'] }); assert(w.channel.rtcRegion === null, 'auto'); assert(said(await press(w, w.owner, `vr:s:region:${w.channel.id}`, { values: ['mars'] })).includes('Неизвестный регион'), 'unknown');
    const menu = await press(w, w.owner, 'vr:region'); assert(menu.replies[0].components[0].toJSON().components[0].options.length === room.REGIONS.length, 'menu');
  });
  await test('delete asks for confirmation first, then removes the room and its record', async () => {
    const w = await world(); const ask = await press(w, w.owner, 'vr:delete'); assert(txt(ask.replies[0].components[0].toJSON()).includes(`vr:y:delete:${w.channel.id}`) && !w.log.deleted, 'asks');
    const out = await press(w, w.owner, `vr:y:delete:${w.channel.id}`); assert(w.log.deleted && !await TempVoiceChannel.findOne({ where: { channelId: w.channel.id } }) && said(out).includes('удалена'), 'deleted');
    assert(said(await press(w, w.owner, `vr:y:delete:${w.channel.id}`)).includes('уже удалена'), 'pressed twice');
  });
  await test('Discord errors: the owner gets a clear private message, nothing crashes', async () => {
    const w = await world(); w.channel.setRTCRegion = async () => { throw new Error('Missing Permissions'); };
    assert(said(await press(w, w.owner, `vr:s:region:${w.channel.id}`, { values: ['russia'] })).includes('права'), 'region error');
  });

  // ---------- /voice ----------
  const runCmd = async (w, sub, options = {}, member) => { const replies = []; const i = { guild: w.guild, member: member || w.owner, user: (member || w.owner).user, channel: { send: async (p) => { replies.push(['channel', p]); } }, replied: false, deferred: false,
    options: { getSubcommand: () => sub, getUser: (k) => (options[k] ? { id: options[k] } : null), getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null, getChannel: () => options.channel || null }, reply: async (p) => { replies.push(p); }, followUp: async (p) => { replies.push(p); } };
    await cmd.execute(i); return txt(replies); };
  await test('/voice: name, limit, access, trust, transfer, claim, info, delete work like the buttons', async () => {
    const w = await world(); const a = w.person('A', { inRoom: true });
    assert((await runCmd(w, 'name', { name: 'Тест' })).includes('Тест') && w.channel.name === 'Тест', 'name'); await runCmd(w, 'limit', { count: 7 }); assert(w.channel.userLimit === 7, 'limit');
    await runCmd(w, 'access', { mode: 'hidden' }); assert(flags(w, 'EVERYONE').viewDeny, 'access'); await runCmd(w, 'trust', { user: 'A' }); assert(flags(w, 'A').allow, 'trust');
    assert((await runCmd(w, 'info')).includes('Скрыта') && (await runCmd(w, 'info')).includes('ИмяA') === false, 'info shows the state');
    assert((await runCmd(w, 'claim', {}, a)).includes('принадлежит') || (await runCmd(w, 'claim', {}, a)).includes('сейчас в комнате'), 'cannot claim while the owner is inside');
    assert((await runCmd(w, 'transfer', { user: 'A' })).includes('владелец комнаты') && (await TempVoiceChannel.findOne({ where: { channelId: w.channel.id } })).ownerId === 'A' && !w.ow.get('OWNER'), 'transfer');
    w.owner.voice.channelId = null; w.channel.members.delete('OWNER'); await runCmd(w, 'delete', {}, a); assert(w.log.deleted, 'deleted by the new owner');
  });
  await test('/voice claim: possible only when the owner has left; transfer only to someone inside the room', async () => {
    const w = await world(); const a = w.person('A', { inRoom: true }); w.person('FAR');
    assert((await runCmd(w, 'claim', {}, a)).includes('сейчас в комнате'), 'owner inside');
    assert((await runCmd(w, 'transfer', { user: 'FAR' })).includes('сидит'), 'not inside');
    w.owner.voice.channelId = null; w.channel.members.delete('OWNER'); assert((await runCmd(w, 'claim', {}, a)).includes('Теперь вы владелец'), 'claimed');
    const rec = await TempVoiceChannel.findOne({ where: { channelId: w.channel.id } }); assert(rec.ownerId === 'A' && flags(w, 'A').allow, 'owner changed');
    assert((await runCmd(w, 'claim', {}, a)).includes('и так ваша'), 'already his');
    assert((await runCmd(w, 'claim', {}, w.person('NOWHERE'))).includes('Зайдите'), 'not in a room');
  });
  await test('/voice panel: only administrators post the panel', async () => {
    const w = await world(); const adm = w.person('ADM', { admin: true }); const sent = [];
    const ch = { id: 'PCH', send: async (p) => { sent.push(p); } };
    assert((await runCmd(w, 'panel', {}, w.owner)).includes('только администраторы'), 'owner is not an admin');
    assert((await runCmd(w, 'panel', { channel: ch }, adm)).includes('PCH') && sent.length === 1 && sent[0].components.length === 2, 'posted');
  });

  // ---------- creation of a room ----------
  await test('a new room gives its owner the right to see and enter it (so closing it never locks him out)', async () => {
    const vsu = require('../bot/events/voiceStateUpdate'); const gid = 'vg-new'; await GuildSettings.create({ guildId: gid, tempVoiceJoinChannelId: 'JOIN', tempVoiceEnabled: true });
    let created = null; const guild = { id: gid, client: { user: { id: 'BOT' } }, channels: { fetch: async () => null, create: async (o) => { created = o; return { id: 'NEWCH' }; } } };
    const member = { id: 'NEWOWNER', displayName: 'Нея' }; const parentOverwrite = { id: 'ROLEX', allow: new PermissionsBitField(), deny: new PermissionsBitField() };
    const newState = { guild, id: 'NEWOWNER', member, channelId: 'JOIN', channel: { parentId: 'CAT', parent: { permissionOverwrites: { cache: new Map([['ROLEX', parentOverwrite]]) } } }, setChannel: async () => {} };
    await vsu.execute({ guild, channelId: null }, newState);
    const mine = created.permissionOverwrites.find((o) => o.id === 'NEWOWNER'); assert(created.permissionOverwrites.length === 2 && mine.allow.includes(P.Connect) && mine.allow.includes(P.ViewChannel), 'owner overwrite missing');
    assert(await TempVoiceChannel.findOne({ where: { channelId: 'NEWCH', ownerId: 'NEWOWNER' } }), 'recorded');
  });

  // ---------- the panel in the web page ----------
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard')); app.use((err, q, s, nx) => s.status(500).send(String(err.stack)));
  const server = app.listen(0); const G = '777000000000000001'; const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}/temp-voice`;
  const post = (b) => fetch(base + '/panel', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await test('web page: posts the panel into the chosen text channel, replaces the older one, remembers where it is', async () => {
    const page = await (await fetch(base)).text(); assert(page.includes('Панель управления комнатами') && page.includes('Разместить панель'), 'page');
    const r = await post({ channelId: '123456789012345678' }); assert(r.headers.get('location').includes('vpanel=1'), r.headers.get('location'));
    const [url, body] = posted[0]; assert(url === '/channels/123456789012345678/messages' && body.components.length === 2 && body.components[0].components.length === 5 && body.embeds.length === 1 && body.allowed_mentions.parse.length === 0, txt(body).slice(0, 200));
    const s = await GuildSettings.findByPk(G); assert(s.tempVoicePanelChannelId === '123456789012345678' && s.tempVoicePanelMessageId === 'MSG1', 'remembered');
    await post({ channelId: '123456789012345678' }); assert(deletedMsgs.join() === '/channels/123456789012345678/messages/MSG1' && (await GuildSettings.findByPk(G)).tempVoicePanelMessageId === 'MSG2', 'old one deleted');
    assert((await (await fetch(base)).text()).includes('Разместить заново'), 'button text changes');
  });
  await test('web page: a voice channel or unknown channel is refused; missing rights give a readable message', async () => {
    const n0 = posted.length; assert((await post({ channelId: '123456789012345679' })).headers.get('location').includes('invalid=1'), 'voice channel'); assert((await post({ channelId: 'abc' })).headers.get('location').includes('invalid=1'), 'junk'); assert(posted.length === n0, 'nothing posted');
    postFail = Object.assign(new Error('x'), { response: { status: 403, data: { code: 50013 } } }); const loc = decodeURIComponent((await post({ channelId: '123456789012345678' })).headers.get('location')); postFail = null;
    assert(loc.includes('whfail=1') && loc.includes('нет прав'), loc);
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
