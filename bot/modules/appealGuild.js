// The appeal server: a separate Discord server where a punished person (a banned one above all) talks to the team.
// The way in is a personal one-use invite (maxUses 1, a limited life), recorded as an AppealGuildPass:
//   instant   — made at once with the punishment and sent in its DM (the site shows it when the DMs are closed);
//   moderator — the person asks (a button in the DM or on the site), the team lets him in or not (buttons in the
//               moderation channel, or the panel's queue); only then the invite is made.
// On the appeal server the bot checks who comes in (onJoin): a person with a pass (or, in the instant mode, with a
// punishment in force) gets the «on appeal» role and, by choice, a private thread; a stranger is left alone, reported or
// kicked. An approved appeal ends the visit (closeFor): the role, the thread and, by choice, the member go.
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const MODES = ['off', 'instant', 'moderator'];
const STRICT = ['off', 'notify', 'kick'];
const db = () => require('../../db');
const bridge = () => require('../../web/botBridge').getClient();
const ap = () => require('./appeals');
const err = (t) => new (ap().AppealError)(t);
const flag = (v, def) => (v === undefined || v === null ? def : v !== false && v !== 0);

/** The appeal-server settings of a main server, read once. */
function cfgOf(s) {
  const mode = MODES.includes(s?.appealGuildMode) ? s.appealGuildMode : 'off';
  const guildId = s?.appealGuildId || null; const channelId = s?.appealInviteChannelId || null;
  return {
    mode, guildId, channelId, on: mode !== 'off' && Boolean(guildId && channelId),
    kinds: String(s?.appealGuildKinds ?? 'ban').split(',').filter((k) => ap().KINDS[k]),
    hours: Math.min(168, Math.max(1, Number(s?.appealInviteHours) || 48)),
    roleId: s?.appealGuildRoleId || null,
    thread: flag(s?.appealGuildThread, false),
    strict: STRICT.includes(s?.appealGuildStrict) ? s.appealGuildStrict : 'off',
    kickOnDone: flag(s?.appealGuildKickOnDone, true)
  };
}
const inviteUrl = (p) => `https://discord.gg/${p.inviteCode}`;
const live = (p) => p?.status === 'issued' && Boolean(p.inviteCode) && (!p.expiresAt || new Date(p.expiresAt) > new Date());

/** What the bot can and cannot do on the appeal server: [{ ok, text }] for the panel. */
function check(s, client = bridge()) {
  const c = cfgOf(s);
  if (!c.guildId) return [];
  const ag = client?.guilds?.cache?.get(c.guildId);
  if (!ag) return [{ ok: false, text: 'Бот не состоит на сервере апелляций — пригласите его туда.' }];
  const out = [{ ok: true, text: `Бот на сервере «${ag.name}».` }];
  const ch = c.channelId ? ag.channels.cache.get(c.channelId) : null;
  const can = (perm, where = ch) => { try { return Boolean(where ? where.permissionsFor(ag.members.me).has(perm) : ag.members.me?.permissions?.has?.(perm)); } catch { return false; } };
  if (!c.channelId) out.push({ ok: false, text: 'Не выбран канал для приглашений.' });
  else if (!ch) out.push({ ok: false, text: 'Канал для приглашений удалён или боту не виден.' });
  else out.push({ ok: can('CreateInstantInvite'), text: can('CreateInstantInvite') ? 'Приглашения создавать может.' : 'Нет права «Создавать приглашения» в этом канале.' });
  if (c.roleId) {
    const role = ag.roles.cache.get(c.roleId);
    const ok = Boolean(role) && can('ManageRoles', null) && role.position < (ag.members.me?.roles?.highest?.position ?? 0);
    out.push({ ok, text: ok ? 'Роль «на апелляции» выдавать может.' : !role ? 'Роль «на апелляции» удалена.' : 'Роль «на апелляции» выше роли бота или нет права «Управлять ролями».' });
  }
  if (c.thread && ch) { const ok = can('CreatePrivateThreads') && can('ManageThreads'); out.push({ ok, text: ok ? 'Приватные ветки создавать может.' : 'Для веток нужны права «Создавать приватные ветки» и «Управлять ветками».' }); }
  if (c.strict === 'kick' || c.kickOnDone) { const ok = can('KickMembers', null); out.push({ ok, text: ok ? 'Выгонять участников может.' : 'Нет права «Выгонять участников» — посторонних и тех, кого простили, бот не уберёт.' }); }
  return out;
}

async function inviteFor(c, reason, client) {
  const ag = client?.guilds?.cache?.get(c.guildId);
  if (!ag) throw err('Бот не состоит на сервере апелляций — приглашение не создать.');
  const ch = ag.channels.cache.get(c.channelId) || (await ag.channels.fetch(c.channelId).catch(() => null));
  if (!ch?.createInvite) throw err('Канал для приглашений на сервере апелляций не найден.');
  try { return await ch.createInvite({ maxAge: c.hours * 3600, maxUses: 1, unique: true, reason: reason.slice(0, 400) }); } catch (e) {
    throw err(Number(e?.code) === 50013 ? 'У бота нет права «Создавать приглашения» в канале сервера апелляций.' : `Discord не дал создать приглашение: ${e?.message || 'неизвестная ошибка'}`);
  }
}

/**
 * A personal one-use invite for this person (an «instant» punishment, an approved request, the site). A live invite of the
 * same person and server is reused. pass: the request row to fill instead of a new one. Returns the pass.
 */
async function issue(guildId, userId, { kind = null, caseNumber = null, by = null, settings = null, client = bridge(), pass = null } = {}) {
  const { AppealGuildPass } = db();
  settings = settings || await require('./leveling').getOrCreateSettings(guildId);
  const c = cfgOf(settings);
  if (!c.on) throw err('Сервер апелляций на этом сервере не настроен.');
  if (!pass) {
    const old = await AppealGuildPass.findOne({ where: { guildId, userId, status: 'issued' }, order: [['id', 'DESC']] });
    if (live(old)) return old;
  }
  const inv = await inviteFor(c, `Апелляция: личное приглашение для ${userId}`, client);
  const values = { appealGuildId: c.guildId, status: 'issued', inviteCode: inv.code, expiresAt: new Date(Date.now() + c.hours * 3600000), approvedBy: by, decidedAt: new Date() };
  if (pass) { await pass.update({ ...values, kind: pass.kind || kind, caseNumber: pass.caseNumber || caseNumber }); return pass; }
  return AppealGuildPass.create({ guildId, userId, kind, caseNumber, ...values });
}

/** The person's punishment on this server that opens the way to the appeal server, or null. */
async function eligible(userId, guildId, c) {
  return (await ap().punishmentsOf(userId)).find((p) => p.guildId === String(guildId) && c.kinds.includes(p.kind)) || null;
}

/**
 * From the site or a DM: «let me onto the appeal server». Instant mode: the invite at once (when the punishment allows).
 * Moderator mode: a request for the team. Returns { pass, issued }.
 */
async function request(userId, guildId, { comment = '', client = bridge() } = {}) {
  const { AppealGuildPass } = db();
  guildId = String(guildId);
  const settings = await require('./leveling').getOrCreateSettings(guildId);
  const c = cfgOf(settings);
  if (!c.on) throw err('На этом сервере нет сервера апелляций.');
  const p = await eligible(userId, guildId, c);
  if (!p) throw err('У вас нет действующего наказания, с которым можно попасть на сервер апелляций.');
  const last = await AppealGuildPass.findOne({ where: { guildId, userId }, order: [['id', 'DESC']] });
  if (live(last)) return { pass: last, issued: true };
  if (last?.status === 'joined') throw err('Вы уже на сервере апелляций.');
  if (c.mode === 'instant') return { pass: await issue(guildId, userId, { kind: p.kind, caseNumber: p.caseNumber, by: client?.user?.id || null, settings, client }), issued: true };
  if (last?.status === 'requested') throw err('Запрос уже отправлен — дождитесь решения модераторов.');
  const pause = Math.max(1, Number(settings.appealsCooldownDays) || 0) * 86400000;
  if (last?.status === 'rejected' && last.decidedAt && new Date(last.decidedAt).getTime() + pause > Date.now()) {
    throw err(`Модераторы отказали в пропуске. Снова попросить можно после ${ap().fmtDate(new Date(new Date(last.decidedAt).getTime() + pause))}.`);
  }
  const pass = await AppealGuildPass.create({ guildId, userId, appealGuildId: c.guildId, kind: p.kind, caseNumber: p.caseNumber, status: 'requested', comment: String(comment || '').trim().slice(0, 300) || null });
  await postRequest(pass, settings, p, client).catch((e) => logger.warn(`appeal pass #${pass.id} request post: ${e.message}`));
  return { pass, issued: false };
}

/** The request in the moderation channel, with «let in» / «refuse». */
async function postRequest(pass, settings, p, client) {
  const guild = client?.guilds?.cache?.get(pass.guildId);
  const id = settings.appealsChannelId || settings.modLogChannelId;
  if (!guild || !id) return;
  const channel = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (!channel?.send) return;
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const e = new EmbedBuilder().setColor(0x9a93ff).setTitle(`🚪 Запрос на сервер апелляций #${pass.id}`)
    .addFields({ name: 'Кто', value: `<@${pass.userId}> (${pass.userId})`, inline: true }, { name: 'Наказание', value: `${ap().KINDS[p.kind] || p.kind}${p.caseNumber ? ` · дело #${p.caseNumber}` : ''}`, inline: true }, { name: 'Причина наказания', value: String(p.reason || '—').slice(0, 300) });
  if (pass.comment) e.setDescription(pass.comment);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apass:ok:${pass.id}`).setLabel('Пропустить на сервер апелляций').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`apass:no:${pass.id}`).setLabel('Отклонить пропуск').setStyle(ButtonStyle.Danger));
  const msg = await channel.send({ embeds: [e], components: [row], allowedMentions: { parse: [] } });
  await pass.update({ modChannelId: channel.id, modMessageId: msg.id });
}

/**
 * A moderator decides a request: 'approve' (the invite is made and sent) or 'reject'. The same rights as for an appeal of
 * that punishment; the status changes by one conditional statement, so two moderators get one decision.
 */
async function decide(passId, guildId, moderatorId, decision, reason = '', { client = bridge() } = {}) {
  const { AppealGuildPass } = db();
  if (!['approve', 'reject'].includes(decision)) throw err('Неизвестное решение.');
  const pass = await AppealGuildPass.findOne({ where: { id: Number(passId) || 0, guildId: String(guildId) } });
  if (!pass) throw err('Запрос не найден.');
  if (pass.status !== 'requested') throw err('По этому запросу уже принято решение.');
  const guild = client?.guilds?.cache?.get(pass.guildId) || null;
  const denied = await ap().mayDecide(guild, moderatorId, pass.kind || 'ban');
  if (denied) throw err(denied);
  const why = String(reason || '').trim().slice(0, 300) || null;
  if (decision === 'reject' && (!why || why.length < 3)) throw err('Укажите причину отказа — её увидит участник.');
  const [n] = await AppealGuildPass.update({ status: decision === 'approve' ? 'approving' : 'rejected', approvedBy: moderatorId, decisionReason: why, decidedAt: new Date() }, { where: { id: pass.id, status: 'requested' } });
  if (!n) throw err('По этому запросу уже принято решение.');
  await pass.reload();
  const settings = await require('./leveling').getOrCreateSettings(pass.guildId);
  if (decision === 'approve') {
    try { await issue(pass.guildId, pass.userId, { by: moderatorId, settings, client, pass }); } catch (e) {
      await pass.update({ status: 'requested', approvedBy: null, decidedAt: null });
      throw e;
    }
  }
  await tellUser(pass, guild, client);
  await markRequest(pass, client, moderatorId);
  return pass;
}

/** The decision in the person's DMs (the site shows it too). */
async function tellUser(pass, guild, client) {
  if (!client?.users?.send) return false;
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const ok = pass.status === 'issued';
  const e = new EmbedBuilder().setColor(ok ? 0x5cb98a : 0xff8d93).setTitle(ok ? 'Вход на сервер апелляций открыт' : 'В пропуске на сервер апелляций отказано')
    .setDescription(ok ? `Личное одноразовое приглашение действует до ${ap().fmtDate(pass.expiresAt)}. Там можно поговорить с модераторами о наказании.` : `Причина: ${pass.decisionReason || '—'}`)
    .addFields({ name: 'Сервер', value: guild?.name || pass.guildId, inline: true });
  const payload = { embeds: [e] };
  if (ok) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setURL(inviteUrl(pass)).setLabel('Перейти на сервер апелляций').setStyle(ButtonStyle.Link))];
  return Boolean(await client.users.send(pass.userId, payload).catch(() => null));
}

/** The request's message in the moderation channel: the buttons go, the decision is written. */
async function markRequest(pass, client, moderatorId) {
  if (!pass.modChannelId || !pass.modMessageId) return;
  const ch = client?.channels?.cache?.get(pass.modChannelId) || (await client?.channels?.fetch?.(pass.modChannelId).catch(() => null));
  const msg = ch?.messages ? await ch.messages.fetch(pass.modMessageId).catch(() => null) : null;
  if (!msg?.edit) return;
  const { EmbedBuilder } = require('discord.js');
  const e = EmbedBuilder.from(msg.embeds[0] || {}).addFields({ name: 'Решение', value: `${pass.status === 'issued' ? '✅ Пропущен' : '❌ Отклонён'} — <@${moderatorId}>${pass.decisionReason ? `: ${pass.decisionReason}` : ''}` });
  await msg.edit({ embeds: [e], components: [], allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * Someone joined a server: if it is the appeal server of some main server, check him. Returns null (not an appeal
 * server), { legit: true, pass } or { legit: false, action }.
 */
async function onJoin(member) {
  if (member.user?.bot) return null;
  const { GuildSettings, AppealGuildPass } = db();
  const mains = (await GuildSettings.findAll({ where: { appealGuildId: member.guild.id } })).filter((s) => cfgOf(s).on);
  if (!mains.length) return null;
  let found = null;
  for (const s of mains) {
    const pass = await AppealGuildPass.findOne({ where: { guildId: s.guildId, userId: member.id, status: { [Op.in]: ['issued', 'joined'] } }, order: [['id', 'DESC']] });
    if (pass) { found = { s, pass }; break; }
  }
  if (!found) {
    for (const s of mains.filter((x) => cfgOf(x).mode === 'instant')) {
      const p = await eligible(member.id, s.guildId, cfgOf(s));
      if (p) { found = { s, pass: await AppealGuildPass.create({ guildId: s.guildId, userId: member.id, appealGuildId: member.guild.id, kind: p.kind, caseNumber: p.caseNumber, status: 'issued', approvedBy: member.client?.user?.id || null }) }; break; }
    }
  }
  if (!found) return stranger(member, mains);
  const c = cfgOf(found.s);
  const pass = found.pass;
  const patch = { status: 'joined', joinedAt: pass.joinedAt || new Date(), appealGuildId: member.guild.id };
  if (c.roleId) await member.roles.add(c.roleId, 'Сервер апелляций: участник с пропуском').catch((e) => logger.warn(`appeal server role: ${e.message}`));
  if (c.thread && !pass.threadId) {
    const ch = member.guild.channels.cache.get(c.channelId);
    const thread = ch?.threads?.create ? await ch.threads.create({ name: `Апелляция · ${member.user?.username || member.id}`.slice(0, 90), type: require('discord.js').ChannelType.PrivateThread, invitable: false, reason: 'Сервер апелляций: разбор наказания' }).catch((e) => { logger.warn(`appeal thread: ${e.message}`); return null; }) : null;
    if (thread) {
      patch.threadId = thread.id;
      await thread.members?.add?.(member.id).catch(() => {});
      await thread.send(await threadIntro(pass, found.s, member)).catch(() => {});
    }
  }
  await pass.update(patch);
  return { legit: true, pass };
}

/** The first message of a visitor's thread: what he is punished for and how to appeal. */
async function threadIntro(pass, settings, member) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const p = (await ap().punishmentsOf(member.id)).find((x) => x.guildId === pass.guildId && (!pass.kind || x.kind === pass.kind));
  const text = [`<@${member.id}>, это ваш разбор наказания. Модераторы увидят здесь ваши сообщения.`,
    p ? `Наказание: **${ap().KINDS[p.kind]}**${p.caseNumber ? ` · дело #${p.caseNumber}` : ''}\nПричина: ${p.reason}` : null,
    'Подайте апелляцию кнопкой ниже — решение придёт в личные сообщения.'].filter(Boolean).join('\n\n');
  const payload = { content: text.slice(0, 2000), allowedMentions: { users: [member.id] } };
  if (settings.appealsDm !== false && settings.appealsDm !== 0) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`appeal:dm:${pass.guildId}`).setLabel('Подать апелляцию').setStyle(ButtonStyle.Primary))];
  return payload;
}

/** No pass and no punishment: by the main server's choice, nothing, a note to its team, or a kick. */
async function stranger(member, mains) {
  const s = mains.find((x) => cfgOf(x).strict !== 'off');
  if (!s) return { legit: false, action: 'none' };
  const c = cfgOf(s);
  if (c.strict === 'kick') {
    const done = await member.kick('Сервер апелляций: нет пропуска и действующего наказания').then(() => true).catch(() => false);
    return { legit: false, action: done ? 'kicked' : 'kick-failed' };
  }
  const main = member.client?.guilds?.cache?.get(s.guildId);
  const id = s.appealsChannelId || s.modLogChannelId;
  const ch = main && id ? main.channels.cache.get(id) || (await main.channels.fetch(id).catch(() => null)) : null;
  await ch?.send?.({ content: `⚠️ На сервер апелляций зашёл <@${member.id}> (${member.id}) без пропуска и без действующего наказания.`, allowedMentions: { parse: [] } }).catch(() => {});
  return { legit: false, action: 'notified' };
}

/** A new appeal of a visitor: tied to his pass and shown in his thread with the decision buttons. */
async function linkAppeal(appeal, client = bridge()) {
  const { AppealGuildPass } = db();
  const pass = await AppealGuildPass.findOne({ where: { guildId: appeal.guildId, userId: appeal.userId, status: { [Op.in]: ['issued', 'joined'] } }, order: [['id', 'DESC']] });
  if (!pass) return null;
  await pass.update({ appealId: appeal.id });
  const thread = pass.threadId ? client?.channels?.cache?.get(pass.threadId) || (await client?.channels?.fetch?.(pass.threadId).catch(() => null)) : null;
  if (thread?.send) {
    const { EmbedBuilder } = require('discord.js');
    const e = new EmbedBuilder().setColor(0x9a93ff).setTitle(`📨 Апелляция #${appeal.id}`).setDescription(appeal.text.slice(0, 1500));
    await thread.send({ embeds: [e], components: ap().decisionButtons(appeal), allowedMentions: { parse: [] } }).catch(() => {});
  }
  return pass;
}

/**
 * The appeal is approved: the visit ends. An unused invite is deleted; a visitor loses the role, his thread is archived
 * and locked, and (by choice) he leaves the appeal server — unless another server's appeal still keeps him there.
 */
async function closeFor(guildId, userId, { reason = 'Апелляция одобрена', client = bridge() } = {}) {
  const { AppealGuildPass, GuildSettings } = db();
  const passes = await AppealGuildPass.findAll({ where: { guildId: String(guildId), userId: String(userId), status: { [Op.in]: ['issued', 'joined'] } } });
  if (!passes.length) return 0;
  const settings = await GuildSettings.findOne({ where: { guildId: String(guildId) } });
  const c = cfgOf(settings);
  for (const pass of passes) {
    const ag = client?.guilds?.cache?.get(pass.appealGuildId || c.guildId);
    if (pass.status === 'issued' && pass.inviteCode) await ag?.invites?.delete?.(pass.inviteCode, reason).catch(() => {});
    if (pass.status === 'joined' && ag) {
      const m = await ag.members.fetch(userId).catch(() => null);
      if (m && c.roleId) await m.roles.remove(c.roleId, reason).catch(() => {});
      const thread = pass.threadId ? ag.channels?.cache?.get(pass.threadId) || (await client.channels?.fetch?.(pass.threadId).catch(() => null)) : null;
      if (thread) { await thread.send?.({ content: `✅ ${reason}. Разбор закрыт.` }).catch(() => {}); await thread.setLocked?.(true).catch(() => {}); await thread.setArchived?.(true).catch(() => {}); }
      const others = await AppealGuildPass.count({ where: { userId: String(userId), appealGuildId: ag.id, status: 'joined', id: { [Op.ne]: pass.id }, guildId: { [Op.ne]: String(guildId) } } });
      if (m && c.kickOnDone && !others) await m.kick(reason).catch(() => {});
    }
    await pass.update({ status: 'closed', closedAt: new Date() });
  }
  return passes.length;
}

/** The person's ways onto appeal servers, for the site: { [guildId]: pass } (the latest of each server). */
async function passesOf(userId) {
  const rows = await db().AppealGuildPass.findAll({ where: { userId: String(userId) }, order: [['id', 'DESC']], limit: 50 });
  const out = {};
  for (const r of rows) if (!out[r.guildId]) out[r.guildId] = r;
  return out;
}

/** The site shows a live invite once (with a grace of 30 minutes): a person whose DMs are closed still gets it. */
async function showOnce(pass) {
  if (!live(pass)) return false;
  if (!pass.shownAt) { await pass.update({ shownAt: new Date() }); return true; }
  return Date.now() - new Date(pass.shownAt).getTime() < 30 * 60000;
}

module.exports = { MODES, STRICT, cfgOf, check, inviteUrl, live, issue, eligible, request, decide, onJoin, linkAppeal, closeFor, passesOf, showOnce };
