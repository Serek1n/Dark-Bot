// Reports v2 (as in Lacuna): a report is about a member, with a category; it lands in the reports channel with buttons for the
// moderators (warn, mute, kick, ban, ignore) — after a decision the buttons lock and the message says who closed it.
// Limits: one report on the same member every 12 hours per person, and a daily limit per person.
const { Op } = require('sequelize');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { Report } = require('../../db');
const embeds = require('../utils/embeds');
const { getOrCreateSettings } = require('./leveling');
const { hierarchyError } = require('../utils/permissions');
const logger = require('../utils/logger');

const PREFIX = 'rep:';
const CATEGORIES = {
  insult: 'Оскорбления и агрессия', spam: 'Спам и флуд', ads: 'Реклама', fraud: 'Мошенничество', toxic: 'Токсичность',
  nsfw: 'Неприемлемый контент (18+)', twink: 'Твинк / обход наказания', raid: 'Рейд, массовые упоминания', other: 'Другое'
};
const SAME_TARGET_MS = 12 * 3600_000;
const MUTES = [['10m', 10 * 60_000, '10 минут'], ['1h', 3600_000, '1 час'], ['1d', 86400_000, '1 день'], ['7d', 7 * 86400_000, '7 дней']];

function reportEmbed(r, { targetTag } = {}) {
  const e = embeds.baseEmbed(r.status === 'open' ? 0xfee75c : r.status === 'done' ? 0x5fd39a : 0x8a8f9e)
    .setTitle(`🚩 Жалоба #${r.id} — ${CATEGORIES[r.category] || CATEGORIES.other}`)
    .addFields(
      { name: 'На кого', value: `<@${r.targetId}>${targetTag ? ` (${targetTag})` : ''}`, inline: true },
      { name: 'От кого', value: `<@${r.reporterId}>`, inline: true }
    );
  if (r.reason) e.addFields({ name: 'Причина', value: String(r.reason).slice(0, 1000) });
  if (r.messageText || r.messageUrl) e.addFields({ name: 'Сообщение', value: `${String(r.messageText || '*(без текста)*').slice(0, 900)}${r.messageUrl ? `\n${r.messageUrl}` : ''}` });
  if (r.status !== 'open') e.addFields({ name: 'Решение', value: `${r.decision || (r.status === 'ignored' ? 'Отклонена' : 'Рассмотрена')} — <@${r.handledBy}> закрыл(а) жалобу` });
  return e;
}

function reportComponents(r) {
  const off = r.status !== 'open';
  const b = (action, label, style) => new ButtonBuilder().setCustomId(`${PREFIX}${r.id}:${action}`).setLabel(label).setStyle(style).setDisabled(off);
  const rows = [new ActionRowBuilder().addComponents(b('warn', 'Предупредить', ButtonStyle.Primary), b('kick', 'Кик', ButtonStyle.Secondary), b('ban', 'Бан', ButtonStyle.Danger), b('ignore', 'Отклонить', ButtonStyle.Secondary))];
  if (!off) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}${r.id}:mute`).setPlaceholder('Мут на…').addOptions(MUTES.map(([v, , label]) => ({ label, value: v })))));
  return rows;
}

/** Creates a report and posts it. Returns { ok, text } for the reporter. */
async function fileReport(guild, { reporter, target, category, reason, message }) {
  const settings = await getOrCreateSettings(guild.id);
  if (!settings.reportEnabled) return { ok: false, text: 'Жалобы на этом сервере отключены.' };
  if (!settings.reportChannelId) return { ok: false, text: 'Канал для жалоб не настроен. Обратитесь к администрации.' };
  if (target.id === reporter.id) return { ok: false, text: 'Нельзя пожаловаться на себя.' };
  if (target.bot) return { ok: false, text: 'На ботов жалобы не принимаются.' };
  const since = new Date(Date.now() - SAME_TARGET_MS);
  if (await Report.count({ where: { guildId: guild.id, reporterId: reporter.id, targetId: target.id, createdAt: { [Op.gte]: since } } })) {
    return { ok: false, text: 'Вы недавно уже отправили жалобу на этого участника. Модераторы её рассмотрят.' };
  }
  const limit = Math.max(1, Number(settings.reportDailyLimit) || 5);
  if ((await Report.count({ where: { guildId: guild.id, reporterId: reporter.id, createdAt: { [Op.gte]: new Date(Date.now() - 86400_000) } } })) >= limit) {
    return { ok: false, text: `За сутки можно отправить не больше ${limit} жалоб.` };
  }
  const channel = guild.channels.cache.get(settings.reportChannelId) || (await guild.channels.fetch(settings.reportChannelId).catch(() => null));
  if (!channel?.send) return { ok: false, text: 'Канал для жалоб недоступен.' };
  const r = await Report.create({
    guildId: guild.id, reporterId: reporter.id, targetId: target.id, category: CATEGORIES[category] ? category : 'other',
    reason: reason ? String(reason).slice(0, 1000) : null, messageUrl: message?.url || null, messageText: message ? String(message.content || '').slice(0, 1000) : null
  });
  const sent = await channel.send({ embeds: [reportEmbed(r, { targetTag: target.tag || target.username })], components: reportComponents(r), allowedMentions: { parse: [] } }).catch(() => null);
  if (!sent) { await r.destroy(); return { ok: false, text: 'Не удалось отправить жалобу: у бота нет прав в канале жалоб.' }; }
  await r.update({ logChannelId: channel.id, logMessageId: sent.id });
  return { ok: true, text: `Жалоба #${r.id} отправлена модераторам.` };
}

const isReportComponent = (i) => typeof i.customId === 'string' && i.customId.startsWith(PREFIX);
const NEED = { warn: P.ModerateMembers, mute: P.ModerateMembers, kick: P.KickMembers, ban: P.BanMembers, ignore: P.ModerateMembers };

/** A moderator pressed a button (or chose a mute length) under a report. */
async function handleReportComponent(i) {
  const deny = (t) => i.reply({ embeds: [embeds.error(t)], flags: MessageFlags.Ephemeral }).catch(() => {});
  const [, idPart, action] = i.customId.split(':');
  const r = await Report.findOne({ where: { id: Number(idPart) || 0, guildId: i.guildId } });
  if (!r) return deny('Жалоба не найдена.');
  if (r.status !== 'open') return deny('Эту жалобу уже закрыли.');
  if (!NEED[action] || !i.member?.permissions?.has?.(NEED[action])) return deny('Для этого действия у вас недостаточно прав.');
  const mod = require('./moderation');
  const settings = await getOrCreateSettings(i.guildId);
  const reason = `Жалоба #${r.id}: ${CATEGORIES[r.category] || ''}${r.reason ? ' — ' + r.reason : ''}`.slice(0, 450);
  let decision = 'Отклонена';
  try {
    if (action !== 'ignore') {
      const target = await i.guild.members.fetch(r.targetId).catch(() => null);
      const hErr = target && hierarchyError(i.member, target);
      if (hErr) return deny(hErr);
      if (action === 'warn') { const user = target?.user || (await i.client.users.fetch(r.targetId)); await mod.warnMember(i.guild, user, { moderatorId: i.user.id, reason, settings }); decision = 'Предупреждение'; }
      if (action === 'mute') {
        const m = MUTES.find(([v]) => v === (i.values || [])[0]);
        if (!m || !target) return deny('Участника нет на сервере или срок не выбран.');
        await mod.muteMember(i.guild, target, m[1], { moderatorId: i.user.id, reason, settings }); decision = `Мут на ${m[2]}`;
      }
      if (action === 'kick') { if (!target) return deny('Участника уже нет на сервере.'); await mod.kickMember(i.guild, target, { moderatorId: i.user.id, reason, settings }); decision = 'Кик'; }
      if (action === 'ban') { await mod.banUser(i.guild, r.targetId, { moderatorId: i.user.id, reason, settings }); decision = 'Бан'; }
    }
  } catch (err) {
    logger.warn(`Report action ${action} failed: ${err.message}`);
    return deny(`Не получилось: ${err.message}`);
  }
  await r.update({ status: action === 'ignore' ? 'ignored' : 'done', decision, handledBy: i.user.id });
  return i.update({ embeds: [reportEmbed(r)], components: reportComponents(r), allowedMentions: { parse: [] } });
}

/** When someone with reports joins: a short note in the reports channel (all, last day, last week, the last three). */
async function joinAlert(member) {
  const settings = await getOrCreateSettings(member.guild.id);
  if (!settings.reportEnabled || !settings.reportJoinAlert || !settings.reportChannelId) return;
  const rows = await Report.findAll({ where: { guildId: member.guild.id, targetId: member.id }, order: [['createdAt', 'DESC']], limit: 50 });
  if (!rows.length) return;
  const now = Date.now();
  const day = rows.filter((r) => now - new Date(r.createdAt).getTime() < 86400_000).length;
  const week = rows.filter((r) => now - new Date(r.createdAt).getTime() < 7 * 86400_000).length;
  const last = rows.slice(0, 3).map((r) => `#${r.id} · ${CATEGORIES[r.category] || ''} · <t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:R>${r.decision ? ' · ' + r.decision : ''}`);
  const channel = member.guild.channels.cache.get(settings.reportChannelId);
  await channel?.send?.({ embeds: [embeds.baseEmbed(0xff9a5c).setTitle('⚠️ Зашёл участник с жалобами').setDescription(`<@${member.id}> (${member.user?.tag || member.id})\nВсего жалоб: **${rows.length}** · за сутки: **${day}** · за 7 дней: **${week}**\n\n${last.join('\n')}`)], allowedMentions: { parse: [] } }).catch(() => {});
}

module.exports = { PREFIX, CATEGORIES, MUTES, fileReport, reportEmbed, reportComponents, isReportComponent, handleReportComponent, joinAlert };
