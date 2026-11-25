// Tickets: the panel message makes a private channel for one member and the staff (a button, or a list of topics when
// the server has them; a topic may ask a few questions first, in a window). Closing it keeps a transcript (text or
// HTML, in the log channel and in the panel), can ask the author for a rating, and quiet tickets close by themselves.
// The settings: GuildSettings.ticketConfig (bot/utils/moduleConfig.js) plus the older columns ticketCategoryId,
// ticketSupportRoleId, ticketLogChannelId and ticketMessage.
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { Op } = require('sequelize');
const { Ticket } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { withLock } = require('../utils/lock');
const { isEnabled } = require('../utils/features');
const { getOrCreateSettings } = require('./leveling');
const mc = require('../utils/moduleConfig');

const OPEN = 'ticket:open';
const CLOSE = 'ticket:close';
const PICK = 'ticket:pick';
const FORM = 'ticket:form:'; // + topic index
const RATE = 'ticket:rate:'; // + ticket id + ':' + 1..5
const isTicketButton = (i) => typeof i.customId === 'string' && (i.customId === OPEN || i.customId === CLOSE || i.customId === PICK || i.customId.startsWith(FORM) || i.customId.startsWith(RATE));

const SEE = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const pad = (n) => String(n).padStart(4, '0');
const slug = (name) => String(name || 'user').toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '').slice(0, 20) || 'user';
const TRANSCRIPT_MAX = 200_000; // characters kept in the database for the panel

const config = (settings) => mc.read(settings, 'tickets');
/** The staff roles: the older single one and the list of the panel. */
const supportRoles = (settings, cfg = config(settings)) => [...new Set([settings?.ticketSupportRoleId, ...cfg.supportRoles].filter(Boolean))];

/** The channel name from the server's format: {number} {user} {category}. */
function channelName(format, { number, user, category }) {
  const name = String(format || 'обращение-{number}-{user}')
    .replace(/\{number\}/g, pad(number)).replace(/\{user\}/g, slug(user)).replace(/\{category\}/g, slug(category || ''))
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9а-яё_-]+/gi, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return (name || `обращение-${pad(number)}`).slice(0, 100);
}

function panelPayload(settings) {
  const cfg = config(settings);
  const text = settings.ticketMessage || 'Нужна помощь?';
  let embed;
  const own = require('../utils/messageBuilder').parseEmbed(cfg.panelEmbed);
  if (own) embed = require('../utils/messageBuilder').buildMessage({ text: '', embed: own }).embeds[0];
  if (!embed) embed = embeds.baseEmbed().setTitle('Обращение к команде сервера').setDescription(`${text}\n\n${cfg.categories.length ? 'Выберите тему ниже' : 'Нажмите на кнопку ниже'}: бот создаст приватный канал, который увидите только вы и команда сервера.`);
  const row = new ActionRowBuilder();
  if (cfg.categories.length) {
    row.addComponents(new StringSelectMenuBuilder().setCustomId(PICK).setPlaceholder(cfg.panelButton || 'Выберите тему обращения').addOptions(cfg.categories.map((c, i) => {
      const o = { label: c.label.slice(0, 100), value: String(i) };
      if (c.description) o.description = c.description.slice(0, 100);
      if (c.emoji) o.emoji = c.emoji;
      return o;
    })));
  } else {
    row.addComponents(new ButtonBuilder().setCustomId(OPEN).setStyle(ButtonStyle.Primary).setEmoji('🎫').setLabel((cfg.panelButton || 'Создать обращение').slice(0, 80)));
  }
  return { content: own ? (text || undefined) : undefined, embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** Posts the panel into a channel, or edits the one posted before there. Returns { message, edited }. */
async function publishPanel(client, guildId, channelId) {
  const settings = await getOrCreateSettings(guildId);
  const cfg = config(settings);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.guildId !== guildId || !channel.send) throw Object.assign(new Error('Канал не найден или в него нельзя писать.'), { user: true });
  const payload = panelPayload(settings);
  let message = null; let edited = false;
  if (cfg.panelMessageId && cfg.panelChannelId === channelId) {
    const old = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (old) { message = await old.edit(payload); edited = true; }
  }
  if (!message) message = await channel.send(payload);
  mc.write(settings, 'tickets', { panelChannelId: channelId, panelMessageId: message.id });
  await settings.save();
  return { message, edited };
}

function canManage(member, ticket, settings) {
  if (!member) return false;
  if (ticket && ticket.userId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;
  return supportRoles(settings).some((r) => member.roles?.cache?.has?.(r));
}
const isStaff = (member, settings) => Boolean(member && (member.permissions?.has?.(PermissionFlagsBits.ManageChannels) || supportRoles(settings).some((r) => member.roles?.cache?.has?.(r))));

// ---- the open tickets' channels, for the last activity (auto-close) ----
const openChannels = new Set();
const touched = new Map(); // channelId → last write, so a busy ticket writes at most once a minute
async function loadOpenChannels() {
  const rows = await Ticket.findAll({ where: { status: 'open' }, attributes: ['channelId'] }).catch(() => []);
  openChannels.clear(); rows.forEach((r) => openChannels.add(r.channelId));
}
/** A message in a ticket channel: the ticket is active (and a «closes soon» warning is withdrawn). */
async function noteActivity(message) {
  const id = message?.channelId;
  if (!id || !openChannels.has(id) || message.author?.bot) return;
  const now = Date.now();
  if (now - (touched.get(id) || 0) < 60_000) return;
  touched.set(id, now);
  await Ticket.update({ lastActivityAt: new Date(now), warnedAt: null }, { where: { channelId: id, status: 'open' } }).catch(() => {});
}

/** Why this member may not open a ticket now, or null. */
async function refusal(guild, user, settings, cfg) {
  if (!isEnabled(settings, 'tickets')) return 'Обращения на этом сервере отключены.';
  if (cfg.blacklist.includes(user.id)) return 'Вам закрыт доступ к обращениям на этом сервере.';
  const open = await Ticket.findAll({ where: { guildId: guild.id, userId: user.id, status: 'open' } });
  const alive = open.filter((t) => guild.channels.cache?.get?.(t.channelId));
  for (const t of open.filter((x) => !alive.includes(x))) { t.status = 'closed'; t.closedAt = new Date(); t.closeReason = 'channel gone'; await t.save(); openChannels.delete(t.channelId); }
  if (alive.length >= cfg.maxOpen) {
    return cfg.maxOpen === 1 ? `У вас уже есть открытое обращение: <#${alive[0].channelId}>.` : `У вас уже ${alive.length} открытых обращений — это предел на этом сервере: ${alive.map((t) => `<#${t.channelId}>`).join(', ')}.`;
  }
  return null;
}

/** The window with the questions of a topic. */
function formModal(index, topic) {
  const modal = new ModalBuilder().setCustomId(FORM + index).setTitle(topic.label.slice(0, 45));
  topic.questions.slice(0, 5).forEach((q, i) => {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q' + i).setLabel(q.label.slice(0, 45))
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(q.required !== false).setMaxLength(q.long ? 1000 : 200)));
  });
  return modal;
}

/** A press on the panel (a button or a topic of the list), or the window of a topic sent. */
async function startTicket(interaction) {
  const { guild, user } = interaction;
  const settings = await getOrCreateSettings(guild.id);
  const cfg = config(settings);
  let index = null;
  if (interaction.customId === PICK) index = Number(interaction.values?.[0]);
  if (interaction.customId?.startsWith(FORM)) index = Number(interaction.customId.slice(FORM.length));
  const topic = index !== null && Number.isInteger(index) ? cfg.categories[index] || null : null;
  if (index !== null && !topic) return interaction.reply({ embeds: [embeds.error('Эта тема обращений больше не существует. Выберите другую.')], flags: MessageFlags.Ephemeral });

  const why = await refusal(guild, user, settings, cfg);
  if (why) return interaction.reply({ embeds: [embeds.info(why)], flags: MessageFlags.Ephemeral });
  // a topic with questions: the window first (it must be the first answer to the press)
  if (topic && topic.questions.length && !interaction.isModalSubmit?.()) return interaction.showModal(formModal(index, topic));
  const answers = topic && interaction.isModalSubmit?.() ? topic.questions.slice(0, 5).map((q, i) => ({ q: q.label, a: String(interaction.fields.getTextInputValue('q' + i) || '').trim() })).filter((x) => x.a) : [];
  return openTicket(interaction, { settings, cfg, topic, answers });
}

async function openTicket(interaction, ctx = null) {
  const { guild, user } = interaction;
  const settings = ctx?.settings || await getOrCreateSettings(guild.id);
  const cfg = ctx?.cfg || config(settings);
  const topic = ctx?.topic || null; const answers = ctx?.answers || [];
  if (!ctx) { const why = await refusal(guild, user, settings, cfg); if (why) return interaction.reply({ embeds: [embeds.info(why)], flags: MessageFlags.Ephemeral }); }
  // Acknowledge first: the channel is made under a lock, and when several people press at once the last ones would
  // otherwise get their answer later than the 3 seconds Discord allows.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = (embed) => interaction.editReply({ embeds: [embed] });

  // One lock per server: the next number is max + 1, so two people opening at once must not get the same one.
  return withLock(`ticket-open:${guild.id}`, async () => {
    const again = await Ticket.count({ where: { guildId: guild.id, userId: user.id, status: 'open' } });
    if (again >= cfg.maxOpen) return reply(embeds.info('У вас уже открыто столько обращений, сколько можно на этом сервере.'));

    const number = ((await Ticket.max('number', { where: { guildId: guild.id } })) || 0) + 1;
    const staff = supportRoles(settings, cfg).filter((r) => guild.roles.cache?.has?.(r));
    const topicRoles = (topic?.roles || []).filter((r) => guild.roles.cache?.has?.(r));
    const overwrites = [
      { id: guild.roles.everyone?.id || guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: SEE },
      { id: interaction.client.user.id, allow: [...SEE, PermissionFlagsBits.ManageChannels] },
      ...[...new Set([...staff, ...topicRoles])].map((id) => ({ id, allow: SEE }))
    ];

    let channel;
    try {
      const category = settings.ticketCategoryId && guild.channels.cache?.get?.(settings.ticketCategoryId);
      channel = await guild.channels.create({
        name: channelName(cfg.nameFormat, { number, user: user.username, category: topic?.label }),
        type: ChannelType.GuildText,
        parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
        topic: `Обращение №${pad(number)} от ${user.username} (${user.id})${topic ? ` · ${topic.label}` : ''}`,
        permissionOverwrites: overwrites
      });
    } catch (err) {
      logger.warn(`Ticket channel was not created in ${guild.id}: ${err.message}`);
      return reply(embeds.error('Не получилось создать канал. Сообщите администрации: боту нужно право «Управлять каналами».'));
    }

    try {
      await Ticket.create({ guildId: guild.id, channelId: channel.id, userId: user.id, number, category: topic?.label || null, answers: answers.length ? JSON.stringify(answers) : null, lastActivityAt: new Date() });
      openChannels.add(channel.id);
    } catch (err) { // no record means nobody could ever close it: take the channel back
      logger.error(`Ticket was not saved in ${guild.id}: ${err.message}`);
      await channel.delete('Обращение не удалось записать').catch(() => {});
      return reply(embeds.error('Не получилось создать обращение. Попробуйте ещё раз.'));
    }
    const ping = [...new Set([...staff, ...topicRoles])];
    const welcome = embeds.baseEmbed().setTitle(`Обращение №${pad(number)}${topic ? ` · ${topic.emoji ? topic.emoji + ' ' : ''}${topic.label}` : ''}`)
      .setDescription(`${(topic?.welcome || settings.ticketMessage || '').slice(0, 3500)}\n\nКогда вопрос решён, нажмите «Закрыть».`);
    if (answers.length) welcome.addFields(answers.slice(0, 5).map((x) => ({ name: x.q.slice(0, 256), value: x.a.slice(0, 1024) })));
    await channel.send({
      content: `<@${user.id}>${ping.map((r) => ` <@&${r}>`).join('')}`,
      embeds: [welcome],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(CLOSE).setStyle(ButtonStyle.Danger).setEmoji('🔒').setLabel('Закрыть обращение'))],
      allowedMentions: { users: [user.id], roles: ping }
    }).catch(() => {});
    return reply(embeds.success(`Обращение создано: <#${channel.id}>.`));
  });
}

// Returns the messages, and list.complete = false when Discord could not be read (then the channel must not be deleted).
async function messagesOf(channel) {
  const list = [];
  let before; let complete = true;
  for (let page = 0; page < 5; page++) { // up to 500 latest messages
    let batch;
    try { batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }); } catch { complete = false; break; }
    if (!batch?.size) break;
    const arr = [...batch.values()];
    list.push(...arr);
    before = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  list.reverse();
  list.complete = complete;
  return list;
}
const stamp = (m) => new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
const filesOf = (m) => (m.attachments?.size ? [...m.attachments.values()].map((a) => a.url) : []);
function transcriptText(msgs) {
  return msgs.map((m) => `[${stamp(m)}] ${m.author?.username || '?'}: ${m.content || ''}${filesOf(m).length ? ` [вложения: ${filesOf(m).join(', ')}]` : ''}`).join('\n');
}
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function transcriptHtml(msgs, title) {
  const rows = msgs.map((m) => `<div class="m"><time>${escHtml(stamp(m))}</time> <b>${escHtml(m.author?.username || '?')}</b><p>${escHtml(m.content || '').replace(/\n/g, '<br>')}</p>${filesOf(m).map((u) => `<a href="${escHtml(u)}">${escHtml(u.split('/').pop().split('?')[0])}</a>`).join(' ')}</div>`).join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;background:#16181d;color:#e6e6e6}h1{font-size:18px}.m{padding:8px 0;border-bottom:1px solid #2a2d34}time{color:#8a8f98;font-size:12px}p{margin:2px 0 0;white-space:pre-wrap}a{color:#9a93ff}</style></head><body><h1>${escHtml(title)}</h1>\n${rows || '<p>Сообщений нет</p>'}\n</body></html>`;
}

/**
 * Closes a ticket: the transcript (in the log channel and the panel), the author's rating, then the channel goes.
 * by: who closed it (a member's ID, or null for the bot itself); reason: shown in the log and the panel.
 * Returns { ok, kept } — kept: the channel stays because the conversation could not be saved.
 */
async function closeCore(guild, channel, ticket, { by = null, reason = null, delayMs = 5000, settings = null } = {}) {
  settings = settings || await getOrCreateSettings(guild.id);
  const cfg = config(settings);
  const claimed = await withLock(`ticket-close:${ticket.id}`, async () => {
    await ticket.reload();
    if (ticket.status !== 'open') return false;
    ticket.status = 'closed'; ticket.closedBy = by; ticket.closedAt = new Date(); ticket.closeReason = reason ? String(reason).slice(0, 250) : null;
    await ticket.save();
    return true;
  });
  if (!claimed) return { ok: false };
  openChannels.delete(ticket.channelId);

  const msgs = channel ? await messagesOf(channel) : Object.assign([], { complete: false });
  const title = `Обращение №${pad(ticket.number)}${ticket.category ? ` · ${ticket.category}` : ''}`;
  if (cfg.transcript !== 'off' && msgs.complete) {
    const text = transcriptText(msgs);
    ticket.transcript = text.slice(0, TRANSCRIPT_MAX); await ticket.save().catch(() => {});
  }
  const logChannel = settings.ticketLogChannelId ? await guild.channels.fetch(settings.ticketLogChannelId).catch(() => null) : null;
  let saved = !settings.ticketLogChannelId || cfg.transcript === 'off'; // nowhere (or nothing) to keep: the channel goes as before
  if (logChannel && cfg.transcript !== 'off' && msgs.complete) {
    const html = cfg.transcript === 'html';
    const file = new AttachmentBuilder(Buffer.from(html ? transcriptHtml(msgs, title) : transcriptText(msgs) || '(сообщений нет)', 'utf8'), { name: `обращение-${pad(ticket.number)}.${html ? 'html' : 'txt'}` });
    const fields = [
      { name: 'Автор', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Закрыл', value: by ? `<@${by}>` : 'бот', inline: true },
      { name: 'Сообщений', value: String(msgs.length), inline: true }
    ];
    if (reason) fields.push({ name: 'Причина', value: String(reason).slice(0, 1024) });
    await logChannel.send({ embeds: [embeds.baseEmbed().setTitle(`${title} закрыто`).addFields(fields)], files: [file], allowedMentions: { parse: [] } })
      .then(() => { saved = true; }).catch((err) => logger.warn(`Ticket log failed: ${err.message}`));
  }
  // the author is asked how it went (in DMs: the channel is about to go)
  if (cfg.rating) askRating(guild, ticket).catch(() => {});
  // The conversation could not be read or kept: the channel stays, so nothing is lost; the team deletes it by hand.
  if (channel && settings.ticketLogChannelId && cfg.transcript !== 'off' && (!msgs.complete || !saved)) {
    await channel.send({ embeds: [embeds.error('Не удалось сохранить переписку в журнал обращений, поэтому канал не удалён. Сохраните нужное и удалите канал вручную.')] }).catch(() => {});
    return { ok: true, kept: true };
  }
  if (channel) {
    const remove = () => channel.delete(`${title} закрыто`).catch(() => {});
    if (delayMs > 0) setTimeout(remove, delayMs).unref?.();
    else await remove();
  }
  return { ok: true, kept: false };
}

async function closeTicket(interaction, { delayMs = 5000 } = {}) {
  const { guild, channel, user } = interaction;
  const settings = await getOrCreateSettings(guild.id);
  const ticket = await Ticket.findOne({ where: { guildId: guild.id, channelId: channel.id, status: 'open' } });
  if (!ticket) return interaction.reply({ embeds: [embeds.error('Это не канал открытого обращения.')], flags: MessageFlags.Ephemeral });
  if (!canManage(interaction.member, ticket, settings)) {
    return interaction.reply({ embeds: [embeds.error('Закрыть обращение может его автор или команда сервера.')], flags: MessageFlags.Ephemeral });
  }
  if (ticket.status !== 'open') return interaction.reply({ embeds: [embeds.info('Обращение уже закрывается.')], flags: MessageFlags.Ephemeral });
  await interaction.reply({ embeds: [embeds.info(`🔒 Обращение закрыто. Канал удалится через ${Math.round(delayMs / 1000)} сек.`)] });
  const r = await closeCore(guild, channel, ticket, { by: user.id, delayMs, settings });
  return r.ok ? ticket : null;
}

/** From the panel: closes a ticket of this server by its id. */
async function closeById(client, guildId, id, byUserId, reason = null) {
  const ticket = await Ticket.findOne({ where: { id, guildId, status: 'open' } });
  if (!ticket) return { ok: false, why: 'gone' };
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return { ok: false, why: 'offline' };
  const channel = guild.channels.cache.get(ticket.channelId) || await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) await channel.send({ embeds: [embeds.info(`🔒 Обращение закрыто из панели${reason ? `: ${String(reason).slice(0, 300)}` : ''}.`)] }).catch(() => {});
  return closeCore(guild, channel, ticket, { by: byUserId, reason: reason || 'закрыто из панели', delayMs: channel ? 3000 : 0 });
}

// ---- the rating ----
async function askRating(guild, ticket) {
  const user = await guild.client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  const row = new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) => new ButtonBuilder().setCustomId(`${RATE}${ticket.id}:${n}`).setStyle(n >= 4 ? ButtonStyle.Success : n <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary).setLabel('★'.repeat(n))));
  await user.send({ embeds: [embeds.info(`Ваше обращение №${pad(ticket.number)} на сервере **${guild.name}** закрыто. Как вам помогли?`)], components: [row] });
}
async function rate(interaction) {
  const [, , id, n] = interaction.customId.split(':');
  const value = Number(n);
  const ticket = await Ticket.findByPk(Number(id));
  if (!ticket || ticket.userId !== interaction.user.id || !(value >= 1 && value <= 5)) return interaction.reply({ embeds: [embeds.error('Эту оценку поставить нельзя.')], flags: MessageFlags.Ephemeral }).catch(() => {});
  if (ticket.rating) return interaction.update({ embeds: [embeds.info(`Вы уже оценили это обращение: ${'★'.repeat(ticket.rating)}.`)], components: [] }).catch(() => {});
  ticket.rating = value; await ticket.save();
  return interaction.update({ embeds: [embeds.success(`Спасибо! Оценка ${'★'.repeat(value)} передана команде сервера.`)], components: [] }).catch(() => {});
}

async function handleTicketButton(interaction) {
  if (interaction.customId.startsWith(RATE)) return rate(interaction);
  if (!interaction.guild) return;
  if (interaction.customId === CLOSE) return closeTicket(interaction);
  return startTicket(interaction);
}

/** Add or remove a member from the current ticket channel. */
async function changeAccess(interaction, member, grant) {
  const settings = await getOrCreateSettings(interaction.guild.id);
  const ticket = await Ticket.findOne({ where: { guildId: interaction.guild.id, channelId: interaction.channel.id, status: 'open' } });
  const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
  if (!ticket) return deny('Эта команда работает только в канале открытого обращения.');
  if (!canManage(interaction.member, ticket, settings)) return deny('Это могут делать автор обращения и команда сервера.');
  if (member.id === ticket.userId) return deny('Автора обращения нельзя убрать из его обращения.');
  // The bot keeps its own access (it closes the ticket and writes the log), and staff are not removed by the author.
  if (!grant && member.id === interaction.client.user?.id) return deny('Бота нельзя убрать из обращения.');
  if (!grant && (supportRoles(settings).includes(member.id) || isStaff(member, settings))) return deny('Команду сервера нельзя убрать из обращения.');
  if (grant) await interaction.channel.permissionOverwrites.edit(member.id, Object.fromEntries(['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'].map((p) => [p, true])));
  else await interaction.channel.permissionOverwrites.delete(member.id);
  return interaction.reply({ embeds: [embeds.success(grant ? `<@${member.id}> добавлен в обращение.` : `<@${member.id}> убран из обращения.`)], allowedMentions: { parse: [] } });
}

// ---- quiet tickets close by themselves ----
/** One pass: warns the tickets that are close to the limit and closes the ones past it. */
async function autoClose(client, now = Date.now()) {
  const { GuildSettings } = require('../../db');
  const rows = await GuildSettings.findAll({ where: { ticketConfig: { [Op.like]: '%autoCloseHours%' } }, attributes: ['guildId', 'ticketConfig', 'ticketLogChannelId', 'ticketsEnabled', 'ticketSupportRoleId'] }).catch(() => []);
  for (const s of rows) {
    const cfg = config(s);
    if (!cfg.autoCloseHours) continue;
    const guild = client.guilds.cache.get(s.guildId); if (!guild) continue;
    const open = await Ticket.findAll({ where: { guildId: s.guildId, status: 'open' } });
    for (const t of open) {
      const last = new Date(t.lastActivityAt || t.createdAt).getTime();
      const quiet = now - last;
      const limit = cfg.autoCloseHours * 3600_000;
      const channel = guild.channels.cache.get(t.channelId);
      if (quiet >= limit) {
        await closeCore(guild, channel || null, t, { by: null, reason: `нет сообщений ${cfg.autoCloseHours} ч`, delayMs: 0 }).catch((err) => logger.warn(`Auto-close ${t.id}: ${err.message}`));
      } else if (cfg.warnHours && !t.warnedAt && quiet >= limit - cfg.warnHours * 3600_000 && channel) {
        const left = Math.max(1, Math.round((limit - quiet) / 3600_000));
        await channel.send({ content: `<@${t.userId}>`, embeds: [embeds.info(`⏳ В этом обращении давно нет сообщений. Если ничего не напишут, оно закроется само через ${left} ч.`)], allowedMentions: { users: [t.userId] } }).catch(() => {});
        t.warnedAt = new Date(now); await t.save();
      }
    }
  }
}
let timer = null;
function startTicketJobs(client) {
  loadOpenChannels().catch(() => {});
  clearInterval(timer);
  timer = setInterval(() => autoClose(client).catch((err) => logger.warn(`Ticket auto-close failed: ${err.message}`)), 10 * 60_000);
  timer.unref?.();
}

/**
 * After a restart: channels of tickets closed earlier are deleted (the delayed deletion lives only in memory and is lost
 * when the bot stops within those seconds).
 */
async function sweepClosedTickets(client) {
  startTicketJobs(client);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const closed = await Ticket.findAll({ where: { status: 'closed', closedAt: { [Op.gte]: since } }, limit: 200 }).catch(() => []);
  for (const t of closed) {
    const channel = client.guilds.cache.get(t.guildId)?.channels?.cache?.get(t.channelId);
    if (channel) await channel.delete(`Обращение №${pad(t.number)} закрыто`).catch(() => {});
  }
}

module.exports = {
  sweepClosedTickets, startTicketJobs, autoClose, noteActivity, loadOpenChannels, OPEN, CLOSE, PICK, FORM, RATE, isTicketButton, handleTicketButton,
  openTicket, startTicket, closeTicket, closeById, closeCore, panelPayload, publishPanel, changeAccess, canManage, supportRoles, channelName,
  transcriptText, transcriptHtml, config, pad
};
