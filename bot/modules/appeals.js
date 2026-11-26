// Appeals against punishments (bans, mutes, warnings). The punished person signs in on the site with Discord — he does not
// have to be on the server — sees his punishments that are still in force and appeals one of them. The punishment is always
// looked up by the bot itself for the signed-in person: an id of someone else's punishment, or one that is no longer in
// force, is refused. Moderators read, comment, approve or reject; an approved appeal lifts the punishment by itself (unban,
// timeout removed, warning revoked — the history stays, with who lifted it and why).
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const KINDS = { ban: 'Бан', mute: 'Мут', warn: 'Предупреждение', role_mute: 'Мут ролью', quarantine: 'Карантин' };
const STATUS = { new: 'Новая', review: 'На рассмотрении', info: 'Нужны подробности', approved: 'Одобрена', rejected: 'Отклонена' };
const OPEN = ['new', 'review', 'info'];
const PERM = { ban: 'BanMembers', mute: 'ModerateMembers', warn: 'ModerateMembers', role_mute: 'ManageRoles', quarantine: 'ManageRoles' };
const PERM_NAME = { BanMembers: 'Банить участников', ModerateMembers: 'Отправлять участников подумать', ManageRoles: 'Управлять ролями' };
const ROLE_KINDS = ['role_mute', 'quarantine'];
const TEXT_MIN = 20; const TEXT_MAX = 2000;
const MAX_LINKS = 3;
const DAY = 86400000;
const PER_DAY = 5; // appeals one person may file in a day, on all servers together

class AppealError extends Error {}
const db = () => require('../../db');
const client = () => require('../../web/botBridge').getClient();
const kindsOn = (settings) => String(settings?.appealsKinds ?? 'ban,mute,warn,role_mute,quarantine').split(',').filter((k) => KINDS[k]);
const isOn = (settings) => settings?.appealsEnabled !== false && settings?.appealsEnabled !== 0;
const panelBase = () => (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
const fmtDate = (d) => (d ? new Date(d).toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Is this ban still in force? Asks Discord when the bot is on that server; otherwise the journal decides. */
async function banInForce(guildId, userId, entry) {
  const { ModLog } = db();
  const later = await ModLog.count({ where: { guildId, userId, action: 'unban', id: { [Op.gt]: entry.id } } });
  if (later) return false;
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return false;
  const guild = client()?.guilds?.cache?.get(guildId);
  if (guild?.bans?.fetch) {
    const ban = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
    return Boolean(ban);
  }
  return true;
}

/** Is this mute still in force? The member's timeout when the bot sees him, else its length in the journal. */
async function muteInForce(guildId, userId, entry) {
  const { ModLog } = db();
  const later = await ModLog.count({ where: { guildId, userId, action: 'unmute', id: { [Op.gt]: entry.id } } });
  if (later) return false;
  const guild = client()?.guilds?.cache?.get(guildId);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (member) return Boolean(member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now());
  const end = new Date(entry.createdAt).getTime() + Number(entry.duration || 0);
  return end > Date.now();
}

/** A punishment as the appeal form shows it. */
function shape(kind, row, extra = {}) {
  const at = row.createdAt;
  const until = kind === 'ban' ? row.expiresAt || null : kind === 'mute' && row.duration ? new Date(new Date(at).getTime() + Number(row.duration)) : null;
  return { kind, guildId: row.guildId, id: row.id, caseNumber: row.caseNumber || null, reason: row.reason || 'Без причины', at, until, ...extra };
}

/**
 * The punishments of one person that are in force right now and may be appealed, on every server where appeals are on.
 * Each: { kind, guildId, id, caseNumber, reason, at, until, open: an open appeal or null, last: the latest appeal or null }.
 */
async function punishmentsOf(userId) {
  const { ModLog, Warning, Appeal, GuildSettings } = db();
  const [logs, warns] = await Promise.all([
    ModLog.findAll({ where: { userId, action: { [Op.in]: ['ban', 'mute'] } }, order: [['id', 'DESC']], limit: 200 }),
    Warning.findAll({ where: { userId, revokedAt: null, createdAt: { [Op.gte]: new Date(Date.now() - 365 * DAY) } }, order: [['id', 'DESC']], limit: 100 })
  ]);
  const guildIds = [...new Set([...logs, ...warns].map((r) => r.guildId))];
  const settings = new Map((await GuildSettings.findAll({ where: { guildId: { [Op.in]: guildIds } } })).map((s) => [s.guildId, s]));
  const out = [];
  const seen = new Set();
  for (const row of logs) { // only the latest ban and the latest mute of each server can be in force
    const k = `${row.guildId}:${row.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = settings.get(row.guildId);
    if (!isOn(s) || !kindsOn(s).includes(row.action)) continue;
    const inForce = row.action === 'ban' ? await banInForce(row.guildId, userId, row) : await muteInForce(row.guildId, userId, row);
    if (inForce) out.push(shape(row.action, row));
  }
  // mute by role and quarantine (bot/modules/punishments.js): in force while their row is active
  const roleRows = await db().RolePunishment.findAll({ where: { userId, active: true, kind: { [Op.in]: ROLE_KINDS } }, order: [['id', 'DESC']], limit: 50 });
  for (const r of roleRows) {
    let s = settings.get(r.guildId);
    if (!s && !settings.has(r.guildId)) { s = await GuildSettings.findOne({ where: { guildId: r.guildId } }); settings.set(r.guildId, s); }
    if (!isOn(s) || !kindsOn(s).includes(r.kind) || !r.caseNumber) continue;
    const entry = await ModLog.findOne({ where: { guildId: r.guildId, caseNumber: r.caseNumber } });
    if (entry && !out.some((p) => p.kind === r.kind && p.id === entry.id)) out.push(shape(r.kind, entry, { until: r.expiresAt || null }));
  }
  const mod = require('./moderation');
  for (const gid of [...new Set(warns.map((w) => w.guildId))]) {
    const s = settings.get(gid);
    if (!isOn(s) || !kindsOn(s).includes('warn')) continue;
    const active = new Set((await mod.activeWarnings(gid, userId, s)).map((w) => w.id));
    for (const w of warns) if (w.guildId === gid && active.has(w.id)) out.push(shape('warn', w));
  }
  const appeals = await Appeal.findAll({ where: { userId }, order: [['id', 'DESC']] });
  for (const p of out) {
    const mine = appeals.filter((a) => a.guildId === p.guildId && a.kind === p.kind && (p.kind === 'warn' ? a.warningId === p.id : a.modLogId === p.id));
    p.open = mine.find((a) => OPEN.includes(a.status)) || null;
    p.last = mine[0] || null;
  }
  return out;
}

/** One punishment of this person, checked: his own, on that server, still in force. Throws AppealError otherwise. */
async function ownPunishment(userId, { guildId, kind, id }) {
  if (!KINDS[kind]) throw new AppealError('Такое наказание обжаловать нельзя.');
  const list = await punishmentsOf(userId);
  const p = list.find((x) => x.guildId === String(guildId) && x.kind === kind && x.id === Number(id));
  if (!p) throw new AppealError('Это наказание не найдено среди ваших действующих наказаний: оно уже снято, закончилось или принадлежит не вам.');
  return p;
}

/** Links an appeal may carry: https only, at most three. */
function cleanLinks(raw) {
  const list = String(raw || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  if (list.length > MAX_LINKS) throw new AppealError(`Не больше ${MAX_LINKS} ссылок.`);
  for (const l of list) {
    let u; try { u = new URL(l); } catch { throw new AppealError('Ссылка некорректна: ' + l.slice(0, 60)); }
    if (u.protocol !== 'https:' || l.length > 200) throw new AppealError('Ссылки — только https и не длиннее 200 символов.');
  }
  return list.join(' ') || null;
}

/** Files an appeal (everything is checked here, not only in the form). Returns the appeal. */
async function create(userId, { guildId, kind, id, text, links, source = 'web' }) {
  const { Appeal, AppealNote } = db();
  const settings = await require('./leveling').getOrCreateSettings(String(guildId));
  if (!isOn(settings)) throw new AppealError('На этом сервере апелляции выключены.');
  if (!kindsOn(settings).includes(kind)) throw new AppealError('Этот вид наказания на сервере обжаловать нельзя.');
  const body = String(text || '').trim();
  if (body.length < TEXT_MIN) throw new AppealError(`Объясните подробнее: хотя бы ${TEXT_MIN} символов.`);
  if (body.length > TEXT_MAX) throw new AppealError(`Слишком длинно: не больше ${TEXT_MAX} символов.`);
  const cleanLinksValue = settings.appealsLinks === false || settings.appealsLinks === 0 ? null : cleanLinks(links);
  const p = await ownPunishment(userId, { guildId, kind, id });
  const lock = require('../utils/lock');
  return lock.withLock(`appeal:${userId}`, async () => {
    if (await Appeal.count({ where: { userId, createdAt: { [Op.gte]: new Date(Date.now() - DAY) } } }) >= PER_DAY) throw new AppealError(`Не больше ${PER_DAY} апелляций в сутки. Попробуйте завтра.`);
    const open = await Appeal.count({ where: { userId, guildId: p.guildId, status: { [Op.in]: OPEN } } });
    if (open >= Math.max(1, Number(settings.appealsMaxOpen) || 2)) throw new AppealError('У вас уже есть открытые апелляции на этом сервере. Дождитесь решения по ним.');
    const same = p.kind === 'warn' ? { warningId: p.id } : { modLogId: p.id };
    const prev = await Appeal.findOne({ where: { userId, guildId: p.guildId, kind: p.kind, ...same }, order: [['id', 'DESC']] });
    if (prev && OPEN.includes(prev.status)) throw new AppealError('Это наказание уже обжалуется — дождитесь решения.');
    const pause = Math.max(0, Number(settings.appealsCooldownDays) || 0) * DAY;
    if (prev?.status === 'rejected' && prev.decidedAt && new Date(prev.decidedAt).getTime() + pause > Date.now()) {
      throw new AppealError(`Апелляцию на это наказание отклонили. Подать новую можно после ${fmtDate(new Date(new Date(prev.decidedAt).getTime() + pause))}.`);
    }
    const appeal = await Appeal.create({ guildId: p.guildId, userId, kind: p.kind, source: source === 'dm' ? 'dm' : 'web', ...same, caseNumber: p.caseNumber, punishReason: String(p.reason).slice(0, 300), punishedAt: p.at, punishUntil: p.until, text: body, links: cleanLinksValue });
    await AppealNote.create({ appealId: appeal.id, authorId: userId, kind: 'status', text: 'new', visible: true });
    notifyUser(appeal, 'Апелляция принята', 'Модераторы получили её. Решение придёт сюда и будет видно на сайте.').catch(() => {});
    notifyModerators(appeal, settings).catch(() => {});
    require('./appealGuild').linkAppeal(appeal).catch((err) => logger.warn(`appeal #${appeal.id} on the appeal server: ${err.message}`));
    return appeal;
  });
}

/** May this person decide this appeal? The server's owner, an administrator, or someone with the right for that punishment. */
async function mayDecide(guild, moderatorId, kind) {
  if (!guild) return 'Бот сейчас не на этом сервере или не в сети — решение не может быть выполнено.';
  if (guild.ownerId === moderatorId) return null;
  const m = await guild.members.fetch(moderatorId).catch(() => null);
  if (!m) return 'Вы не участник этого сервера.';
  if (m.permissions?.has?.('Administrator') || m.permissions?.has?.(PERM[kind])) return null;
  return `Для решения по этой апелляции нужно право «${PERM_NAME[PERM[kind]] || PERM_NAME.ModerateMembers}».`;
}

/** Can the bot lift it, and is it still in force? Returns { inForce, why } (why: what stops the bot). */
async function liftCheck(guild, appeal) {
  const { ModLog, Warning } = db();
  if (appeal.kind === 'warn') {
    const w = await Warning.findByPk(appeal.warningId);
    return { inForce: Boolean(w && !w.revokedAt), why: null };
  }
  if (ROLE_KINDS.includes(appeal.kind)) {
    const row = await db().RolePunishment.findOne({ where: { guildId: appeal.guildId, userId: appeal.userId, kind: appeal.kind, caseNumber: appeal.caseNumber, active: true } });
    const can = guild.members.me?.permissions?.has?.('ManageRoles');
    return { inForce: Boolean(row), why: row && can === false ? 'У бота нет права «Управлять ролями» — снять наказание он не сможет.' : null };
  }
  const entry = await ModLog.findByPk(appeal.modLogId);
  if (!entry) return { inForce: false, why: null };
  if (appeal.kind === 'ban') {
    const inForce = await banInForce(appeal.guildId, appeal.userId, entry);
    const can = guild.members.me?.permissions?.has?.('BanMembers');
    return { inForce, why: inForce && !can ? 'У бота нет права «Банить участников» — снять бан он не сможет.' : null };
  }
  const member = await guild.members.fetch(appeal.userId).catch(() => null);
  const inForce = Boolean(member?.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now());
  const why = inForce ? require('./moderation').whyCannot(guild, member, 'unmute') : null;
  return { inForce, why };
}

/** Lifts the punishment of an approved appeal. Returns a line for the history. */
async function lift(guild, appeal, moderatorId) {
  const reason = `Апелляция #${appeal.id} одобрена`;
  const mod = require('./moderation');
  const { recordAndAnnounce } = require('../utils/modlog');
  if (appeal.kind === 'warn') {
    const w = await db().Warning.findByPk(appeal.warningId);
    if (!w || !(await mod.revokeWarning(w, { by: moderatorId, reason }))) return 'Предупреждение уже было снято.';
    await recordAndAnnounce(guild, { userId: appeal.userId, moderatorId, action: 'unwarn', reason: `${reason}: снято предупреждение #${w.id}` });
    return 'Предупреждение снято (осталось в истории с отметкой).';
  }
  if (appeal.kind === 'ban') {
    await mod.unbanUser(guild, appeal.userId, { moderatorId, reason });
    return 'Бан снят.';
  }
  if (ROLE_KINDS.includes(appeal.kind)) {
    const row = await db().RolePunishment.findOne({ where: { guildId: appeal.guildId, userId: appeal.userId, kind: appeal.kind, caseNumber: appeal.caseNumber, active: true } });
    if (!row) return 'Наказание уже было снято.';
    const r = await require('./punishments').lift(guild, row, { by: moderatorId, reason });
    if (appeal.kind === 'quarantine') return `Карантин снят, ролей возвращено: ${r.given?.length || 0}${r.skipped?.length ? `, не удалось вернуть: ${r.skipped.length}` : ''}.`;
    return 'Мут ролью снят.';
  }
  const member = await guild.members.fetch(appeal.userId).catch(() => null);
  if (!member) return 'Участника нет на сервере — мут снимать не с кого.';
  await member.timeout(null, reason);
  await recordAndAnnounce(guild, { userId: appeal.userId, moderatorId, action: 'unmute', reason });
  return 'Мут снят.';
}

/**
 * A moderator's decision. decision: 'review' | 'approved' | 'rejected'. Checked: the appeal is still open, the moderator may
 * decide it, and (to approve) the bot can lift the punishment. The status changes by ONE conditional statement, so two
 * moderators pressing at once get one decision; the second is told it is already decided.
 */
async function decide(appealId, guildId, moderatorId, decision, reason = '') {
  const { Appeal, AppealNote } = db();
  if (!['review', 'info', 'approved', 'rejected'].includes(decision)) throw new AppealError('Неизвестное решение.');
  const appeal = await Appeal.findOne({ where: { id: Number(appealId) || 0, guildId: String(guildId) } });
  if (!appeal) throw new AppealError('Апелляция не найдена.');
  if (!OPEN.includes(appeal.status)) throw new AppealError('По этой апелляции уже принято решение.');
  if (decision === 'review' && appeal.status === 'review') throw new AppealError('Апелляция уже на рассмотрении.');
  const why = String(reason || '').trim().slice(0, 500);
  if (decision === 'info' && appeal.status === 'info') throw new AppealError('Подробности уже запрошены — ждём ответа автора.');
  if (decision === 'info' && why.length < 3) throw new AppealError('Напишите, что именно нужно уточнить — вопрос увидит автор апелляции.');
  if (!['review', 'info'].includes(decision) && why.length < 3) throw new AppealError('Укажите причину решения — её увидит автор апелляции.');
  const guild = client()?.guilds?.cache?.get(appeal.guildId) || null;
  const denied = await mayDecide(guild, moderatorId, appeal.kind);
  if (denied) throw new AppealError(denied);
  let check = null;
  if (decision === 'approved') {
    check = await liftCheck(guild, appeal);
    if (check.why) throw new AppealError(check.why);
  }
  const from = decision === 'review' ? ['new'] : decision === 'info' ? ['new', 'review'] : OPEN;
  const final = ['approved', 'rejected'].includes(decision);
  const [changed] = await Appeal.update(
    { status: decision, moderatorId, decisionReason: final ? why : appeal.decisionReason, decidedAt: final ? new Date() : null },
    { where: { id: appeal.id, status: { [Op.in]: from } } }
  );
  if (!changed) throw new AppealError('По этой апелляции уже принято решение.');
  await appeal.reload();
  await AppealNote.create({ appealId: appeal.id, authorId: moderatorId, kind: 'status', text: decision + (why && decision !== 'review' ? `: ${why}` : ''), visible: true });
  if (decision === 'info') await AppealNote.create({ appealId: appeal.id, authorId: moderatorId, kind: 'comment', text: `Вопрос модератора: ${why}`, visible: true });
  if (decision === 'approved') {
    let result;
    try {
      result = check.inForce ? await lift(guild, appeal, moderatorId) : 'Наказание к этому моменту уже не действовало — снимать нечего.';
    } catch (err) {
      result = `Не удалось снять автоматически: ${require('../utils/punishable').apiErrorText(err, appeal.kind === 'ban' ? 'unban' : appeal.kind === 'mute' ? 'unmute' : 'warn')}. Снимите вручную.`;
      logger.warn(`appeal #${appeal.id} lift: ${err.message}`);
    }
    await appeal.update({ actionResult: result.slice(0, 300) });
    await AppealNote.create({ appealId: appeal.id, authorId: null, kind: 'comment', text: result, visible: true });
  }
  const titles = { review: 'Апелляция на рассмотрении', info: 'Модератору нужны подробности', approved: 'Апелляция одобрена', rejected: 'Апелляция отклонена' };
  const bodies = { review: 'Модератор взял её в работу.', info: `Вопрос: ${why}\nОтветьте кнопкой ниже или на сайте.`, approved: `Причина: ${why}\n${appeal.actionResult || ''}`, rejected: `Причина: ${why}` };
  await notifyUser(appeal, titles[decision], bodies[decision]).catch(() => {});
  // the visit on the appeal server ends with the approved appeal (its role, thread and, by the server's choice, the member)
  if (decision === 'approved') await require('./appealGuild').closeFor(appeal.guildId, appeal.userId, { reason: `Апелляция #${appeal.id} одобрена` }).catch((err) => logger.warn(`appeal #${appeal.id} appeal server: ${err.message}`));
  return appeal;
}

/** A moderator's comment; visible: shown to the author on the site (and sent to him). */
async function comment(appealId, guildId, authorId, text, visible = false) {
  const { Appeal, AppealNote } = db();
  const appeal = await Appeal.findOne({ where: { id: Number(appealId) || 0, guildId: String(guildId) } });
  if (!appeal) throw new AppealError('Апелляция не найдена.');
  const body = String(text || '').trim().slice(0, 1000);
  if (body.length < 2) throw new AppealError('Комментарий пустой.');
  const note = await AppealNote.create({ appealId: appeal.id, authorId, kind: 'comment', text: body, visible: Boolean(visible) });
  if (visible) notifyUser(appeal, 'Новый комментарий к апелляции', body).catch(() => {});
  return note;
}

/** The author answers the moderator's question: the appeal goes back to review. */
async function reply(appealId, userId, text) {
  const { Appeal, AppealNote } = db();
  const appeal = await Appeal.findOne({ where: { id: Number(appealId) || 0, userId: String(userId) } });
  if (!appeal) throw new AppealError('Апелляция не найдена.');
  if (appeal.status !== 'info') throw new AppealError('Модератор сейчас ничего не спрашивает по этой апелляции.');
  const body = String(text || '').trim();
  if (body.length < 2) throw new AppealError('Ответ пустой.');
  if (body.length > TEXT_MAX) throw new AppealError(`Слишком длинно: не больше ${TEXT_MAX} символов.`);
  const [changed] = await Appeal.update({ status: 'review' }, { where: { id: appeal.id, status: 'info' } });
  if (!changed) throw new AppealError('Модератор сейчас ничего не спрашивает по этой апелляции.');
  await AppealNote.create({ appealId: appeal.id, authorId: userId, kind: 'comment', text: `Ответ автора: ${body}`.slice(0, 2100), visible: true });
  await appeal.reload();
  const settings = await require('./leveling').getOrCreateSettings(appeal.guildId);
  notifyModerators(appeal, settings, { title: `💬 Ответ по апелляции #${appeal.id}`, text: body }).catch(() => {});
  return appeal;
}

/** A private message to the author (if Discord lets the bot write to him); the site shows the status anyway. */
async function notifyUser(appeal, title, text) {
  const c = client();
  if (!c?.users?.send) return false;
  const guild = c.guilds?.cache?.get(appeal.guildId);
  const { EmbedBuilder } = require('discord.js');
  const color = { approved: 0x5cb98a, rejected: 0xff8d93 }[appeal.status] || 0x9a93ff;
  const e = new EmbedBuilder().setColor(color).setTitle(`${title} · #${appeal.id}`).setDescription(String(text || '').slice(0, 1500))
    .addFields({ name: 'Сервер', value: guild?.name || appeal.guildId, inline: true }, { name: 'Наказание', value: KINDS[appeal.kind], inline: true }, { name: 'Статус', value: STATUS[appeal.status], inline: true });
  if (panelBase()) e.setURL(`${panelBase()}/appeals/${appeal.id}`);
  const payload = { embeds: [e] };
  if (appeal.status === 'info') {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`appeal:reply:${appeal.id}`).setLabel('Ответить модератору').setStyle(ButtonStyle.Primary))];
  }
  return Boolean(await c.users.send(appeal.userId, payload).catch(() => null));
}

/** Tells the server's team about a new appeal: the appeals channel, else the moderation log channel. */
async function notifyModerators(appeal, settings, { title = null, text = null } = {}) {
  const guild = client()?.guilds?.cache?.get(appeal.guildId);
  const id = settings?.appealsChannelId || settings?.modLogChannelId;
  if (!guild || !id) return false;
  const channel = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (!channel?.send) return false;
  const { EmbedBuilder } = require('discord.js');
  const e = new EmbedBuilder().setColor(0x9a93ff).setTitle(title || `📨 Новая апелляция #${appeal.id}${appeal.source === 'dm' ? ' · из ЛС' : ''}`)
    .setDescription(String(text || appeal.text).slice(0, 1000))
    .addFields({ name: 'Кто', value: `<@${appeal.userId}> (${appeal.userId})`, inline: true }, { name: 'Наказание', value: `${KINDS[appeal.kind]}${appeal.caseNumber ? ` · дело #${appeal.caseNumber}` : ''}`, inline: true }, { name: 'Причина наказания', value: appeal.punishReason || '—' });
  if (panelBase()) e.setURL(`${panelBase()}/dashboard/${appeal.guildId}/moderation-appeals/${appeal.id}`);
  return Boolean(await channel.send({ embeds: [e], components: decisionButtons(appeal), allowedMentions: { parse: [] } }).catch(() => null));
}

/** «Одобрить / Отклонить / Уточнить» under an appeal, for the team in Discord (bot/modules/appealDm.js handles them). */
function decisionButtons(appeal) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apdec:approved:${appeal.id}`).setLabel('Одобрить').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`apdec:rejected:${appeal.id}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`apdec:info:${appeal.id}`).setLabel('Запросить подробности').setStyle(ButtonStyle.Secondary)
  )];
}

/**
 * The private message of a punishment, sent BEFORE a ban or kick (while there is still a common server). With appeals on
 * for this kind it carries «appeal here» (a form in the DMs), «open the form on the site» and the appeal server's button
 * (a personal invite in the «instant» mode, a request in the «moderator» one). Closed DMs never stop the punishment.
 * opts.reach = false: the person is not on the server — nothing is sent, an «instant» invite is still made (the site shows it).
 * Returns { message, delivered, skipped, code, pass }.
 */
async function punishmentDm(guild, userId, text, settings, kind = null, { reach = true } = {}) {
  if (settings && (settings.modDmEnabled === false || settings.modDmEnabled === 0)) return { message: null, delivered: false, skipped: true, pass: null };
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const row = new ActionRowBuilder();
  let pass = null;
  if (kind && KINDS[kind] && isOn(settings) && kindsOn(settings).includes(kind)) {
    if (settings.appealsDm !== false && settings.appealsDm !== 0) row.addComponents(new ButtonBuilder().setCustomId(`appeal:dm:${guild.id}`).setLabel('Подать апелляцию здесь').setStyle(ButtonStyle.Primary));
    if (panelBase()) row.addComponents(new ButtonBuilder().setURL(`${panelBase()}/appeals`).setLabel('Открыть форму на сайте').setStyle(ButtonStyle.Link));
    const AG = require('./appealGuild');
    const c = AG.cfgOf(settings);
    if (c.on && c.kinds.includes(kind)) {
      if (c.mode === 'instant') {
        pass = await AG.issue(guild.id, userId, { kind, by: guild.client?.user?.id || null, settings, client: guild.client }).catch((err) => { logger.warn(`appeal server invite: ${err.message}`); return null; });
        if (pass) row.addComponents(new ButtonBuilder().setURL(AG.inviteUrl(pass)).setLabel('Сервер апелляций').setStyle(ButtonStyle.Link));
      } else {
        row.addComponents(new ButtonBuilder().setCustomId(`appeal:pass:${guild.id}`).setLabel('Запросить вход на сервер апелляций').setStyle(ButtonStyle.Secondary));
      }
    }
  }
  if (!reach) return { message: null, delivered: false, skipped: false, code: 'absent', pass };
  const payload = { content: `${text}\n— сервер **${guild.name}**`.slice(0, 2000) };
  if (row.components.length) payload.components = [row];
  else if (kind) payload.content = `${text}${appealHint(settings, kind)}\n— сервер **${guild.name}**`.slice(0, 2000);
  try {
    const message = await guild.client.users.send(userId, payload);
    return { message: message || true, delivered: true, skipped: false, pass };
  } catch (err) {
    return { message: null, delivered: false, skipped: false, code: err?.code ?? err?.rawError?.code ?? null, pass };
  }
}

/** After the case is written: the invite learns its case; an undelivered DM is noted in the case (the site still works). */
async function afterPunishmentDm(guildId, entry, r) {
  if (!r || !entry?.caseNumber) return;
  if (r.pass && !r.pass.caseNumber) await r.pass.update({ caseNumber: entry.caseNumber }).catch(() => {});
  if (r.delivered || r.skipped) return;
  const why = r.code === 50007 ? 'у участника закрыты личные сообщения (50007)' : r.code === 'absent' ? 'участника нет на сервере' : 'Discord не принял сообщение';
  await db().CaseNote.create({ guildId, caseNumber: entry.caseNumber, authorId: null, kind: 'note', text: `Уведомление в ЛС не доставлено: ${why}. Обжаловать можно на сайте /appeals${r.pass ? ', там же будет приглашение на сервер апелляций' : ''}.` }).catch(() => {});
}

/** The line added to a punishment's private message: where to appeal it. */
function appealHint(settings, kind) {
  if (!isOn(settings) || !kindsOn(settings).includes(kind) || !panelBase()) return '';
  return `\nНе согласны? Подайте апелляцию: ${panelBase()}/appeals`;
}

module.exports = { KINDS, STATUS, OPEN, PERM, ROLE_KINDS, reply, decisionButtons, punishmentDm, afterPunishmentDm, TEXT_MIN, TEXT_MAX, MAX_LINKS, PER_DAY, AppealError, kindsOn, isOn, punishmentsOf, ownPunishment, cleanLinks, create, decide, comment, mayDecide, liftCheck, notifyUser, notifyModerators, appealHint, fmtDate };
