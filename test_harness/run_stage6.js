// Stage 6 — appeals in the bot's DMs and the appeal server. The DM goes before the ban (with its buttons), closed DMs
// (50007) never stop a punishment and are noted in the case, a form in the DMs files an appeal (limits shared with the
// site), the moderator asks for more and the author answers, the «instant» mode makes a personal one-use invite, the
// «moderator» mode goes through a request the team decides, the appeal server checks who comes in, and an approved appeal
// lifts a ban, a mute by role or a quarantine and ends the visit. Discord is faked.
process.env.DATABASE_PATH = './data/test_stage6.sqlite';
process.env.WEB_BASE_URL = 'https://dark.example';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n(), signedIn: (q, s, n) => { q.user = { id: q.get('x-user') || 'U1' }; n(); } });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.user = { id: q.get('x-user') || 'MOD' }; n(); } });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }], getGuildRoles: async () => [],
  getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: {}
});
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings, Appeal, AppealGuildPass, CaseNote, ModLog, RolePunishment } = db;
  const ap = require('../bot/modules/appeals');
  const AG = require('../bot/modules/appealGuild');
  const dmh = require('../bot/modules/appealDm');
  const modSvc = require('../bot/modules/moderation');
  const P = require('../bot/modules/punishments');
  const mc = require('../bot/utils/moduleConfig');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  // ---- two fake servers: the main one (G) and the appeal server (AG) ----
  const log = []; // the order of things: dm / ban / invite / kick
  const dms = []; const closed = new Set();
  const client = { user: { id: 'BOT' }, guilds: { cache: new Map() }, channels: { cache: new Map(), fetch: async (id) => client.channels.cache.get(id) || null },
    users: { send: async (id, p) => { if (closed.has(id)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }); log.push(`dm:${id}`); dms.push({ id, p, t: typeof p === 'string' ? p : p.content || '' }); return { id: 'm' + dms.length, delete: async () => {} }; } } };
  require('../web/botBridge').setClient(client);
  const S = { MUTE: '500000000000000001', QUAR: '500000000000000002', R1: '500000000000000003', AROLE: '500000000000000004', MODCH: '500000000000000005', INV: '500000000000000006', AGID: '600000000000000001', GID: '600000000000000002', OTHER: '600000000000000003' };
  const role = (id, position, o = {}) => ({ id, name: id, position, managed: false, comparePositionTo(x) { return position - x.position; }, ...o });
  const perms = (yes) => ({ has: () => yes });
  const modMsgs = [];
  const textChannel = (id, guild) => {
    const ch = { id, name: 'ch' + id, type: 0, guild, position: 0, threads: { list: [], create: async (o) => { const t = { id: 'T' + (ch.threads.list.length + 1), name: o.name, type: o.type, members: { added: [], add: async (u) => { t.members.added.push(u); } }, sent: [], send: async (m) => { t.sent.push(m); return {}; }, locked: false, archived: false, setLocked: async (v) => { t.locked = v; }, setArchived: async (v) => { t.archived = v; } }; ch.threads.list.push(t); client.channels.cache.set(t.id, t); return t; } },
      invites: [], createInvite: async (o) => { log.push('invite'); const inv = { code: 'code' + (ch.invites.length + 1), ...o }; ch.invites.push(inv); return inv; },
      sent: [], send: async (m) => { ch.sent.push(m); const msg = { id: 'msg' + (modMsgs.length + 1), embeds: m.embeds || [], components: m.components, edit: async (x) => { msg.edited = x; } }; modMsgs.push(msg); ch.messages.map.set(msg.id, msg); return msg; },
      messages: { map: new Map(), fetch: async (mid) => ch.messages.map.get(mid) || null }, permissionsFor: () => perms(true) };
    client.channels.cache.set(id, ch); return ch;
  };
  const membersOf = new Map();
  const makeGuild = (id, name) => {
    const g = { id, name, client, ownerId: 'OWNER', bans: { set: new Set(), fetch: async ({ user }) => (g.bans.set.has(user) ? { user } : null) },
      roles: { cache: new Map([[id, role(id, 0)], [S.MUTE, role(S.MUTE, 3)], [S.QUAR, role(S.QUAR, 3)], [S.R1, role(S.R1, 4)], [S.AROLE, role(S.AROLE, 2)]]) }, channels: { cache: new Map(), fetch: async (cid) => g.channels.cache.get(cid) || null },
      invites: { deleted: [], delete: async (code) => { g.invites.deleted.push(code); } } };
    const ms = new Map(); membersOf.set(id, ms);
    g.members = { me: { id: 'BOT', permissions: perms(true), roles: { highest: role('Dark', 10) } },
      fetch: async (q) => { const uid = typeof q === 'object' ? q.user : q; const m = ms.get(uid); if (!m) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return m; },
      ban: async (uid) => { log.push(`ban:${uid}`); g.bans.set.add(uid); ms.delete(uid); }, unban: async (uid) => { if (!g.bans.set.has(uid)) throw Object.assign(new Error('Unknown Ban'), { code: 10026 }); g.bans.set.delete(uid); } };
    client.guilds.cache.set(id, g); return g;
  };
  const G = makeGuild(S.GID, 'Main'); const AGG = makeGuild(S.AGID, 'Appeals');
  const modCh = textChannel(S.MODCH, G); G.channels.cache.set(S.MODCH, modCh);
  const invCh = textChannel(S.INV, AGG); AGG.channels.cache.set(S.INV, invCh);
  const member = (g, id, roleIds = [], o = {}) => {
    const cache = new Map(roleIds.map((r) => [r, g.roles.cache.get(r)]));
    const m = { id, guild: g, client, user: { id, bot: false, username: 'u' + id }, permissions: perms(Boolean(o.mod)), moderatable: true, kickable: true, bannable: true, communicationDisabledUntilTimestamp: null,
      roles: { cache, get highest() { return [...cache.values()].reduce((a, r) => (r.position > a.position ? r : a), role('none', o.top || 0)); },
        add: async (x) => { for (const r of [].concat(x)) cache.set(r, g.roles.cache.get(r)); }, remove: async (r) => { cache.delete(r); }, set: async (l) => { cache.clear(); for (const r of l) cache.set(r, g.roles.cache.get(r)); } },
      timeout: async () => {}, kick: async () => { log.push(`kick:${id}@${g.id}`); membersOf.get(g.id).delete(id); } };
    membersOf.get(g.id).set(id, m); return m;
  };
  member(G, 'MOD', [], { mod: true, top: 9 });
  member(G, 'WEAK', [], { mod: false, top: 9 });
  await GuildSettings.create({ guildId: S.GID, modDmEnabled: true, appealsChannelId: S.MODCH, appealsKinds: 'ban,mute,warn,role_mute,quarantine' });
  const setS = (v) => GuildSettings.update(v, { where: { guildId: S.GID } });
  const S0 = async () => GuildSettings.findOne({ where: { guildId: S.GID } });
  { const s = await S0(); mc.write(s, 'mod', { ...mc.read(s, 'mod'), muteRoleId: S.MUTE, quarantineRoleId: S.QUAR }); await s.save(); }
  const buttonsOf = (p) => (p?.components || []).flatMap((r) => (r.toJSON ? r.toJSON() : r).components);

  // a fake interaction (a DM: no guild)
  const press = (customId, userId, o = {}) => {
    const i = { customId, user: { id: userId }, client, replied: false, deferred: false, replies: [], modal: null, values: o.values, fields: { getTextInputValue: (k) => { if (!(k in (o.fields || {}))) throw new Error('no field'); return o.fields[k]; } },
      reply: async (p) => { i.replied = true; i.replies.push(p); return p; }, followUp: async (p) => { i.replies.push(p); return p; }, showModal: async (m) => { i.modal = m.toJSON ? m.toJSON() : m; } };
    return dmh.handle(i).then(() => i);
  };
  const said = (i) => JSON.stringify(i.replies);
  const LONG = 'Я не нарушал правила, это была шутка между друзьями, прошу пересмотреть.';

  // ================= the DM before the ban =================
  await test('ban: the DM goes BEFORE the ban, with «appeal here» and «open the form on the site»', async () => {
    member(G, 'U1', [S.R1]); log.length = 0;
    await modSvc.banUser(G, 'U1', { moderatorId: 'MOD', reason: 'Спам', settings: await S0() });
    assert(log.indexOf('dm:U1') >= 0 && log.indexOf('dm:U1') < log.indexOf('ban:U1'), 'order: ' + log.join(' '));
    const d = dms.find((x) => x.id === 'U1'); const b = buttonsOf(d.p);
    assert(b.some((x) => x.custom_id === `appeal:dm:${S.GID}`) && b.some((x) => x.url === 'https://dark.example/appeals'), JSON.stringify(b));
    assert(/забанены/.test(d.t), d.t);
  });
  await test('closed DMs (50007): the ban still happens; the case says the DM was not delivered and points to the site', async () => {
    member(G, 'U2'); closed.add('U2');
    const entry = await modSvc.banUser(G, 'U2', { moderatorId: 'MOD', reason: 'Флуд', settings: await S0() });
    assert(G.bans.set.has('U2'), 'banned');
    const note = await CaseNote.findOne({ where: { guildId: S.GID, caseNumber: entry.caseNumber } });
    assert(note && /50007/.test(note.text) && /\/appeals/.test(note.text), note?.text);
  });
  await test('kinds off: a warning DM without appeal buttons when warnings are not appealable', async () => {
    await setS({ appealsKinds: 'ban' }); member(G, 'U3'); dms.length = 0;
    await modSvc.warnMember(G, { id: 'U3' }, { moderatorId: 'MOD', reason: 'Оффтоп', settings: await S0() });
    assert(dms.length === 1 && !buttonsOf(dms[0].p).length, JSON.stringify(dms[0]?.p));
    await setS({ appealsKinds: 'ban,mute,warn,role_mute,quarantine' });
  });

  // ================= the appeal in the DMs =================
  await test('DM appeal: the button opens the form; too short is refused; a good one is an appeal from the DMs', async () => {
    const i = await press(`appeal:dm:${S.GID}`, 'U1');
    assert(i.modal && i.modal.custom_id.startsWith(`appeal:m:${S.GID}|ban|`), JSON.stringify(i.modal));
    const textInput = i.modal.components[0].components[0];
    assert(textInput.min_length === 20 && textInput.max_length === 2000, 'limits in the form');
    const short = await press(i.modal.custom_id, 'U1', { fields: { text: 'коротко', links: '' } });
    assert(/хотя бы 20/.test(said(short)), said(short));
    const ok = await press(i.modal.custom_id, 'U1', { fields: { text: LONG, links: '' } });
    const a = await Appeal.findOne({ where: { userId: 'U1' } });
    assert(a && a.source === 'dm' && a.kind === 'ban' && /отправлена/.test(said(ok)), said(ok));
    assert(modCh.sent.some((m) => JSON.stringify(m.embeds).includes('из ЛС') && buttonsOf(m).some((b) => b.custom_id === `apdec:approved:${a.id}`)), 'the team sees it with decision buttons');
  });
  await test('DM appeal: the same punishment again is refused (one open appeal), someone else cannot appeal it', async () => {
    const again = await press(`appeal:dm:${S.GID}`, 'U1');
    assert(/уже подана/.test(said(again)) && !again.modal, said(again));
    const a = await Appeal.findOne({ where: { userId: 'U1' } });
    const other = await press(`appeal:m:${S.GID}|ban|${a.modLogId}`, 'U9', { fields: { text: LONG } });
    assert(/не найдено/.test(said(other)), said(other));
  });
  await test('more information: the moderator asks, the author gets a reply button, answers, the appeal is back in review', async () => {
    const a = await Appeal.findOne({ where: { userId: 'U1' } }); dms.length = 0;
    await ap.decide(a.id, S.GID, 'MOD', 'info', 'Пришлите скриншот переписки');
    await a.reload(); assert(a.status === 'info', a.status);
    const d = dms.find((x) => x.id === 'U1');
    assert(d && buttonsOf(d.p).some((b) => b.custom_id === `appeal:reply:${a.id}`), 'reply button in the DM');
    const form = await press(`appeal:reply:${a.id}`, 'U1');
    assert(form.modal?.custom_id === `appeal:rm:${a.id}`, 'reply form');
    await press(`appeal:rm:${a.id}`, 'U1', { fields: { text: 'Вот ссылка: https://imgur.com/x' } });
    await a.reload(); assert(a.status === 'review', a.status);
    let e = null; try { await ap.reply(a.id, 'U1', 'ещё'); } catch (x) { e = x.message; }
    assert(/ничего не спрашивает/.test(e), e);
  });
  await test('rejected: a new appeal on it waits out the pause, from the DMs as from the site', async () => {
    const a = await Appeal.findOne({ where: { userId: 'U1' } });
    await ap.decide(a.id, S.GID, 'MOD', 'rejected', 'Нарушение подтверждено');
    const i = await press(`appeal:m:${S.GID}|ban|${a.modLogId}`, 'U1', { fields: { text: LONG } });
    assert(/можно после/.test(said(i)), said(i));
  });
  await test('/appeal (my punishments and appeals) answers in the DMs with a menu of what can still be appealed', async () => {
    member(G, 'U4');
    await modSvc.banUser(G, 'U4', { moderatorId: 'MOD', reason: 'Реклама', settings: await S0() });
    const cmd = require('../bot/commands/moderation/appeal');
    assert(cmd.dmAllowed === true && cmd.data.toJSON().dm_permission === true, 'works in DMs');
    const i = { user: { id: 'U4' }, client, replies: [], reply: async (p) => { i.replies.push(p); } };
    await cmd.execute(i);
    const p = i.replies[0];
    assert(/Реклама/.test(JSON.stringify(p.embeds)) && buttonsOf(p).some((c) => c.custom_id === 'appeal:pick'), JSON.stringify(p).slice(0, 300));
  });

  // ================= the appeal server: instant =================
  await setS({ appealGuildId: S.AGID, appealInviteChannelId: S.INV, appealGuildMode: 'instant', appealGuildKinds: 'ban,quarantine', appealInviteHours: 24, appealGuildRoleId: S.AROLE, appealGuildThread: true, appealGuildStrict: 'kick', appealGuildKickOnDone: true });
  await test('instant: the ban makes a personal one-use invite (24 h) tied to the case, sent in the same DM before the ban', async () => {
    member(G, 'U5'); log.length = 0; dms.length = 0;
    const entry = await modSvc.banUser(G, 'U5', { moderatorId: 'MOD', reason: 'Токсичность', settings: await S0() });
    assert(log.indexOf('invite') < log.indexOf('dm:U5') && log.indexOf('dm:U5') < log.indexOf('ban:U5'), log.join(' '));
    const inv = invCh.invites[invCh.invites.length - 1];
    assert(inv.maxUses === 1 && inv.maxAge === 24 * 3600 && inv.unique, JSON.stringify(inv));
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U5' } });
    assert(pass.status === 'issued' && pass.inviteCode === inv.code && pass.caseNumber === entry.caseNumber, JSON.stringify(pass.toJSON()));
    assert(buttonsOf(dms[0].p).some((b) => b.url === `https://discord.gg/${inv.code}`), 'the invite in the DM');
  });
  await test('instant with closed DMs: the invite waits on the site, shown once (then only its state)', async () => {
    member(G, 'U6'); closed.add('U6');
    await modSvc.banUser(G, 'U6', { moderatorId: 'MOD', reason: 'Обход бана', settings: await S0() });
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U6' } });
    assert(AG.live(pass), 'live');
    assert(await AG.showOnce(pass) === true, 'shown first time');
    await pass.update({ shownAt: new Date(Date.now() - 31 * 60000) });
    assert(await AG.showOnce(pass) === false, 'not shown again after the grace');
  });
  await test('the appeal server: a visitor with a pass gets the role and a private thread; a stranger is kicked', async () => {
    const v = member(AGG, 'U5'); log.length = 0;
    const r = await AG.onJoin(v);
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U5' } });
    assert(r.legit && pass.status === 'joined' && v.roles.cache.has(S.AROLE) && pass.threadId, JSON.stringify(pass.toJSON()));
    const t = client.channels.cache.get(pass.threadId);
    assert(t.members.added.includes('U5') && /Токсичность/.test(JSON.stringify(t.sent[0])), 'thread with the punishment');
    const s = member(AGG, 'STRANGER');
    const rs = await AG.onJoin(s);
    assert(!rs.legit && rs.action === 'kicked' && log.includes(`kick:STRANGER@${S.AGID}`), JSON.stringify(rs));
  });
  await test('a visitor\'s appeal appears in his thread with the decision buttons', async () => {
    const list = await ap.punishmentsOf('U5'); const p = list.find((x) => x.kind === 'ban');
    const a = await ap.create('U5', { guildId: S.GID, kind: 'ban', id: p.id, text: LONG, source: 'dm' });
    await new Promise((r) => setTimeout(r, 50));
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U5' } });
    const t = client.channels.cache.get(pass.threadId);
    assert(pass.appealId === a.id && t.sent.some((m) => buttonsOf(m).some((b) => b.custom_id === `apdec:approved:${a.id}`)), 'in the thread');
  });
  await test('approved (from the buttons): the ban is lifted, the role goes, the thread is closed, the visitor leaves', async () => {
    const a = await Appeal.findOne({ where: { userId: 'U5' } });
    const weak = await press(`apdec:approved:${a.id}`, 'WEAK');
    assert(/нужно право/.test(said(weak)) && !weak.modal, 'no rights — no form: ' + said(weak));
    const form = await press(`apdec:approved:${a.id}`, 'MOD');
    assert(form.modal?.custom_id === `apdecm:approved:${a.id}`, 'form');
    log.length = 0;
    await press(form.modal.custom_id, 'MOD', { fields: { reason: 'Разобрались, бан снят' } });
    await a.reload();
    assert(a.status === 'approved' && !G.bans.set.has('U5') && /Бан снят/.test(a.actionResult), a.actionResult);
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U5' } });
    const t = client.channels.cache.get(pass.threadId);
    assert(pass.status === 'closed' && t.locked && t.archived && log.includes(`kick:U5@${S.AGID}`), JSON.stringify(pass.toJSON()) + log.join(' '));
  });
  await test('approved with an unused invite: the invite is deleted', async () => {
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U6' } });
    const p = (await ap.punishmentsOf('U6')).find((x) => x.kind === 'ban');
    const a = await ap.create('U6', { guildId: S.GID, kind: 'ban', id: p.id, text: LONG });
    await ap.decide(a.id, S.GID, 'MOD', 'approved', 'Ошибка модератора');
    await pass.reload();
    assert(pass.status === 'closed' && AGG.invites.deleted.includes(pass.inviteCode), 'invite deleted');
  });

  // ================= the appeal server: through a moderator =================
  await setS({ appealGuildMode: 'moderator', appealGuildStrict: 'notify' });
  await test('moderator mode: the DM offers «ask to enter»; the request goes to the team with buttons', async () => {
    member(G, 'U7'); dms.length = 0;
    await modSvc.banUser(G, 'U7', { moderatorId: 'MOD', reason: 'Угрозы', settings: await S0() });
    assert(buttonsOf(dms[0].p).some((b) => b.custom_id === `appeal:pass:${S.GID}`), 'request button');
    assert(!(await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U7' } })), 'no invite before the team decides');
    const form = await press(`appeal:pass:${S.GID}`, 'U7');
    assert(form.modal?.custom_id === `apassm:${S.GID}`, 'comment form');
    const r = await press(form.modal.custom_id, 'U7', { fields: { comment: 'Хочу объясниться' } });
    assert(/Запрос отправлен/.test(said(r)), said(r));
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U7' } });
    assert(pass.status === 'requested' && pass.comment === 'Хочу объясниться' && pass.modMessageId, JSON.stringify(pass.toJSON()));
    const again = await press(form.modal.custom_id, 'U7', { fields: { comment: '' } });
    assert(/уже отправлен/.test(said(again)), said(again));
  });
  await test('moderator mode: someone without the right cannot let in; the panel needs appeals.decide', async () => {
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U7' } });
    const r = await press(`apass:ok:${pass.id}`, 'WEAK');
    await pass.reload();
    assert(/нужно право/.test(said(r)) && pass.status === 'requested', said(r));
    const access = require('../web/utils/access');
    assert(access.scopeFor('POST', `/moderation-appeals/pass/${pass.id}/approve`) .join() === 'appeals.decide', 'scope of the panel route');
    assert(access.scopeFor('POST', '/moderation/appeal-guild') .join() === 'appeals.decide', 'scope of the settings');
  });
  await test('moderator mode: let in → a one-use invite in the DM, the request message closed; then the join is legit', async () => {
    const pass = await AppealGuildPass.findOne({ where: { guildId: S.GID, userId: 'U7' } }); dms.length = 0;
    await press(`apass:ok:${pass.id}`, 'MOD');
    await pass.reload();
    assert(pass.status === 'issued' && pass.inviteCode && pass.approvedBy === 'MOD', JSON.stringify(pass.toJSON()));
    assert(buttonsOf(dms.find((d) => d.id === 'U7').p).some((b) => b.url === `https://discord.gg/${pass.inviteCode}`), 'invite in the DM');
    const msg = modMsgs.find((m) => m.id === pass.modMessageId);
    assert(msg.edited && msg.edited.components.length === 0, 'buttons removed');
    const second = await press(`apass:ok:${pass.id}`, 'MOD');
    assert(/уже принято решение/.test(said(second)), 'decided once');
    const v = member(AGG, 'U7');
    const j = await AG.onJoin(v); await pass.reload();
    assert(j.legit && pass.status === 'joined', 'joined');
  });
  await test('moderator mode: a refusal needs a reason, is sent to the person, and a new request waits out the pause', async () => {
    member(G, 'U8');
    await modSvc.banUser(G, 'U8', { moderatorId: 'MOD', reason: 'Спам', settings: await S0() });
    const { pass } = await AG.request('U8', S.GID, { comment: 'пустите' });
    const form = await press(`apass:no:${pass.id}`, 'MOD');
    assert(form.modal?.custom_id === `apass:nm:${pass.id}`, 'reason form');
    dms.length = 0;
    await press(form.modal.custom_id, 'MOD', { fields: { reason: 'Сначала подайте апелляцию' } });
    await pass.reload();
    assert(pass.status === 'rejected' && /Сначала подайте/.test(JSON.stringify(dms.find((d) => d.id === 'U8').p)), 'told');
    let e = null; try { await AG.request('U8', S.GID, {}); } catch (x) { e = x.message; }
    assert(/Снова попросить можно после/.test(e), e);
  });
  await test('moderator mode: a stranger is reported to the team; without a punishment nobody can ask', async () => {
    const before = modCh.sent.length;
    const r = await AG.onJoin(member(AGG, 'NOBODY'));
    assert(!r.legit && r.action === 'notified' && modCh.sent.length === before + 1, JSON.stringify(r));
    let e = null; try { await AG.request('NOBODY', S.GID, {}); } catch (x) { e = x.message; }
    assert(/нет действующего наказания/.test(e), e);
  });

  // ================= role punishments =================
  await test('an approved appeal lifts a mute by role and gives a quarantine\'s roles back', async () => {
    const s = await S0();
    const m1 = member(G, 'RM', [S.R1]);
    await P.apply(G, m1, 'role_mute', { moderatorId: 'MOD', reason: 'Капс', settings: s });
    const pm = (await ap.punishmentsOf('RM')).find((x) => x.kind === 'role_mute');
    assert(pm, 'a mute by role can be appealed');
    const a1 = await ap.create('RM', { guildId: S.GID, kind: 'role_mute', id: pm.id, text: LONG });
    await ap.decide(a1.id, S.GID, 'MOD', 'approved', 'Снято по апелляции');
    await a1.reload();
    assert(!m1.roles.cache.has(S.MUTE) && /Мут ролью снят/.test(a1.actionResult), a1.actionResult);
    const m2 = member(G, 'QU', [S.R1]);
    await P.apply(G, m2, 'quarantine', { moderatorId: 'MOD', reason: 'Слив', settings: s });
    assert(!m2.roles.cache.has(S.R1) && m2.roles.cache.has(S.QUAR), 'in quarantine');
    const pq = (await ap.punishmentsOf('QU')).find((x) => x.kind === 'quarantine');
    const a2 = await ap.create('QU', { guildId: S.GID, kind: 'quarantine', id: pq.id, text: LONG });
    await ap.decide(a2.id, S.GID, 'MOD', 'approved', 'Снято по апелляции');
    await a2.reload();
    assert(m2.roles.cache.has(S.R1) && !m2.roles.cache.has(S.QUAR) && /ролей возвращено: 1/.test(a2.actionResult), a2.actionResult);
    assert(!(await RolePunishment.count({ where: { userId: 'QU', active: true } })), 'nothing active');
  });

  // ================= the panel and the site =================
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use('/appeals', require('../web/routes/appeals'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const srv = app.listen(0); const root = `http://127.0.0.1:${srv.address().port}`;
  const post = (u, o, user) => fetch(root + u, { method: 'POST', body: new URLSearchParams(o), redirect: 'manual', headers: user ? { 'x-user': user } : {} });
  await test('panel: the appeal server can be set only by someone who manages it', async () => {
    const OTHER = makeGuild(S.OTHER, 'Чужой'); member(OTHER, 'MOD', [], { mod: false });
    const r = await post(`/dashboard/${S.GID}/moderation/appeal-guild`, { appealGuildMode: 'instant', appealGuildId: S.OTHER, appealInviteChannelId: S.INV }, 'MOD');
    assert(/err=/.test(r.headers.get('location')) && (await S0()).appealGuildId === S.AGID, decodeURIComponent(r.headers.get('location')));
    const self = await post(`/dashboard/${S.GID}/moderation/appeal-guild`, { appealGuildMode: 'instant', appealGuildId: S.GID }, 'MOD');
    assert(/err=/.test(self.headers.get('location')), 'not itself');
    membersOf.get(S.AGID).get('U7').permissions = perms(false);
    member(AGG, 'MOD', [], { mod: true });
    const ok = await post(`/dashboard/${S.GID}/moderation/appeal-guild`, { appealGuildMode: 'moderator', appealGuildId: S.AGID, appealInviteChannelId: S.INV, agkind_ban: 'on', agkind_quarantine: 'on', appealInviteHours: '72', appealGuildStrict: 'notify', appealGuildKickOnDone: 'on' }, 'MOD');
    const s = await S0();
    assert(!/err=/.test(ok.headers.get('location')) && s.appealGuildMode === 'moderator' && s.appealInviteHours === 72 && s.appealGuildKinds === 'ban,quarantine' && s.appealInviteChannelId === S.INV, ok.headers.get('location'));
  });
  await test('panel: the appeals page shows the appeal server card and the pass queue; a pass is decided there', async () => {
    member(G, 'U10');
    await modSvc.banUser(G, 'U10', { moderatorId: 'MOD', reason: 'Спам', settings: await S0() });
    const { pass } = await AG.request('U10', S.GID, { comment: 'с сайта' });
    const html = await (await fetch(`${root}/dashboard/${S.GID}/moderation-appeals`)).text();
    assert(html.includes('Сервер апелляций') && html.includes('Пропуска на сервер апелляций') && html.includes(`/moderation-appeals/pass/${pass.id}/approve`), html.slice(0, 300));
    const r = await post(`/dashboard/${S.GID}/moderation-appeals/pass/${pass.id}/reject`, { reason: '' }, 'MOD');
    await pass.reload(); assert(pass.status === 'requested' && /err=/.test(r.headers.get('location')), 'a reason is needed');
    await post(`/dashboard/${S.GID}/moderation-appeals/pass/${pass.id}/approve`, {}, 'MOD');
    await pass.reload(); assert(pass.status === 'issued', pass.status);
  });
  await test('site: the punished person asks to enter from the site; a question of the moderator is answered there', async () => {
    member(G, 'U11');
    await modSvc.banUser(G, 'U11', { moderatorId: 'MOD', reason: 'Спам', settings: await S0() });
    const page = await (await fetch(`${root}/appeals`, { headers: { 'x-user': 'U11' } })).text();
    assert(page.includes('Запросить вход на сервер апелляций'), 'request button on the site');
    const r = await post('/appeals/pass', { g: S.GID, comment: 'хочу поговорить' }, 'U11');
    assert(/pass=requested/.test(r.headers.get('location')), r.headers.get('location'));
    const p = (await ap.punishmentsOf('U11')).find((x) => x.kind === 'ban');
    const a = await ap.create('U11', { guildId: S.GID, kind: 'ban', id: p.id, text: LONG });
    await ap.decide(a.id, S.GID, 'MOD', 'info', 'Когда это было?');
    const show = await (await fetch(`${root}/appeals/${a.id}`, { headers: { 'x-user': 'U11' } })).text();
    assert(show.includes('Модератору нужны подробности') && show.includes('Когда это было?'), 'question shown');
    await post(`/appeals/${a.id}/reply`, { text: 'Вчера вечером' }, 'U11');
    await a.reload(); assert(a.status === 'review', a.status);
  });
  srv.close();

  const bad = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : '\n   ' + r.e}`));
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
