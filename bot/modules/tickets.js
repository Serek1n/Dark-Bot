// Tickets: a button makes a private channel for one member and the staff. Closing it saves a transcript.
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const { Ticket } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { withLock } = require('../utils/lock');
const { isEnabled } = require('../utils/features');
const { getOrCreateSettings } = require('./leveling');

const OPEN = 'ticket:open';
const CLOSE = 'ticket:close';
const isTicketButton = (i) => i.isButton?.() && (i.customId === OPEN || i.customId === CLOSE);

const SEE = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const pad = (n) => String(n).padStart(4, '0');
const slug = (name) => String(name || 'user').toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '').slice(0, 20) || 'user';

function panelPayload(settings) {
  return {
    embeds: [embeds.baseEmbed().setTitle('Обращение к команде сервера').setDescription(`${settings.ticketMessage || 'Нужна помощь?'}\n\nНажмите на кнопку ниже: бот создаст приватный канал, который увидите только вы и команда сервера.`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(OPEN).setStyle(ButtonStyle.Primary).setEmoji('🎫').setLabel('Создать обращение'))]
  };
}

function canManage(member, ticket, settings) {
  if (!member) return false;
  if (ticket && ticket.userId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;
  return Boolean(settings?.ticketSupportRoleId && member.roles?.cache?.has?.(settings.ticketSupportRoleId));
}

async function openTicket(interaction) {
  const { guild, user } = interaction;
  const settings = await getOrCreateSettings(guild.id);
  const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  if (!isEnabled(settings, 'tickets')) return reply(embeds.info('Обращения на этом сервере отключены.'));

  // One lock per server: the next number is max + 1, so two people opening at once must not get the same one.
  return withLock(`ticket-open:${guild.id}`, async () => {
    const existing = await Ticket.findOne({ where: { guildId: guild.id, userId: user.id, status: 'open' } });
    if (existing && guild.channels.cache?.get?.(existing.channelId)) return reply(embeds.info(`У вас уже есть открытое обращение: <#${existing.channelId}>.`));
    if (existing) { existing.status = 'closed'; existing.closedAt = new Date(); await existing.save(); } // its channel is gone

    const number = ((await Ticket.max('number', { where: { guildId: guild.id } })) || 0) + 1;
    const overwrites = [
      { id: guild.roles.everyone?.id || guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: SEE },
      { id: interaction.client.user.id, allow: [...SEE, PermissionFlagsBits.ManageChannels] }
    ];
    if (settings.ticketSupportRoleId && guild.roles.cache?.has?.(settings.ticketSupportRoleId)) overwrites.push({ id: settings.ticketSupportRoleId, allow: SEE });

    let channel;
    try {
      const category = settings.ticketCategoryId && guild.channels.cache?.get?.(settings.ticketCategoryId);
      channel = await guild.channels.create({
        name: `обращение-${pad(number)}-${slug(user.username)}`,
        type: ChannelType.GuildText,
        parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
        topic: `Обращение №${pad(number)} от ${user.username} (${user.id})`,
        permissionOverwrites: overwrites
      });
    } catch (err) {
      logger.warn(`Ticket channel was not created in ${guild.id}: ${err.message}`);
      return reply(embeds.error('Не получилось создать канал. Сообщите администрации: боту нужно право «Управлять каналами».'));
    }

    await Ticket.create({ guildId: guild.id, channelId: channel.id, userId: user.id, number });
    const staffPing = settings.ticketSupportRoleId ? ` <@&${settings.ticketSupportRoleId}>` : '';
    await channel.send({
      content: `<@${user.id}>${staffPing}`,
      embeds: [embeds.baseEmbed().setTitle(`Обращение №${pad(number)}`).setDescription(`${settings.ticketMessage || ''}\n\nКогда вопрос решён, нажмите «Закрыть».`)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(CLOSE).setStyle(ButtonStyle.Danger).setEmoji('🔒').setLabel('Закрыть обращение'))],
      allowedMentions: { users: [user.id], roles: settings.ticketSupportRoleId ? [settings.ticketSupportRoleId] : [] }
    }).catch(() => {});
    return reply(embeds.success(`Обращение создано: <#${channel.id}>.`));
  });
}

async function transcriptOf(channel) {
  const lines = [];
  let before;
  for (let page = 0; page < 5; page++) { // up to 500 latest messages
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    const arr = [...batch.values()];
    lines.push(...arr);
    before = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  return lines.reverse().map((m) => {
    const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    const files = m.attachments?.size ? ` [вложения: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
    return `[${time}] ${m.author?.username || '?'}: ${m.content || ''}${files}`;
  });
}

async function closeTicket(interaction, { delayMs = 5000 } = {}) {
  const { guild, channel, user } = interaction;
  const settings = await getOrCreateSettings(guild.id);
  const ticket = await Ticket.findOne({ where: { guildId: guild.id, channelId: channel.id, status: 'open' } });
  if (!ticket) return interaction.reply({ embeds: [embeds.error('Это не канал открытого обращения.')], flags: MessageFlags.Ephemeral });
  if (!canManage(interaction.member, ticket, settings)) {
    return interaction.reply({ embeds: [embeds.error('Закрыть обращение может его автор или команда сервера.')], flags: MessageFlags.Ephemeral });
  }

  const claimed = await withLock(`ticket-close:${ticket.id}`, async () => {
    await ticket.reload();
    if (ticket.status !== 'open') return false;
    ticket.status = 'closed'; ticket.closedBy = user.id; ticket.closedAt = new Date();
    await ticket.save();
    return true;
  });
  if (!claimed) return interaction.reply({ embeds: [embeds.info('Обращение уже закрывается.')], flags: MessageFlags.Ephemeral });

  await interaction.reply({ embeds: [embeds.info(`🔒 Обращение закрыто. Канал удалится через ${Math.round(delayMs / 1000)} сек.`)] });

  const lines = await transcriptOf(channel);
  const logChannel = settings.ticketLogChannelId ? await guild.channels.fetch(settings.ticketLogChannelId).catch(() => null) : null;
  if (logChannel) {
    const file = new AttachmentBuilder(Buffer.from(lines.join('\n') || '(сообщений нет)', 'utf8'), { name: `обращение-${pad(ticket.number)}.txt` });
    await logChannel.send({
      embeds: [embeds.baseEmbed().setTitle(`Обращение №${pad(ticket.number)} закрыто`).addFields(
        { name: 'Автор', value: `<@${ticket.userId}>`, inline: true },
        { name: 'Закрыл', value: `<@${user.id}>`, inline: true },
        { name: 'Сообщений', value: String(lines.length), inline: true }
      )],
      files: [file],
      allowedMentions: { parse: [] }
    }).catch((err) => logger.warn(`Ticket log failed: ${err.message}`));
  }

  const remove = () => channel.delete(`Обращение №${pad(ticket.number)} закрыто`).catch(() => {});
  if (delayMs > 0) setTimeout(remove, delayMs).unref?.();
  else await remove();
  return ticket;
}

async function handleTicketButton(interaction) {
  if (!interaction.guild) return;
  if (interaction.customId === OPEN) return openTicket(interaction);
  return closeTicket(interaction);
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
  if (!grant && (member.id === settings.ticketSupportRoleId || (member.roles?.cache?.has?.(settings.ticketSupportRoleId)) || member.permissions?.has?.('ManageChannels'))) return deny('Команду сервера нельзя убрать из обращения.');
  if (grant) await interaction.channel.permissionOverwrites.edit(member.id, Object.fromEntries(['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'].map((p) => [p, true])));
  else await interaction.channel.permissionOverwrites.delete(member.id);
  return interaction.reply({ embeds: [embeds.success(grant ? `<@${member.id}> добавлен в обращение.` : `<@${member.id}> убран из обращения.`)], allowedMentions: { parse: [] } });
}

/**
 * After a restart: channels of tickets closed earlier are deleted (the delayed deletion lives only in memory and is lost
 * when the bot stops within those seconds).
 */
async function sweepClosedTickets(client) {
  const { Op } = require('sequelize');
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const closed = await Ticket.findAll({ where: { status: 'closed', closedAt: { [Op.gte]: since } }, limit: 200 }).catch(() => []);
  for (const t of closed) {
    const channel = client.guilds.cache.get(t.guildId)?.channels?.cache?.get(t.channelId);
    if (channel) await channel.delete(`Обращение №${pad(t.number)} закрыто`).catch(() => {});
  }
}

module.exports = { sweepClosedTickets, OPEN, CLOSE, isTicketButton, handleTicketButton, openTicket, closeTicket, panelPayload, changeAccess, canManage, pad };
