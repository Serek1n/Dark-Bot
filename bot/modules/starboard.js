// "Доска почёта" (starboard): a message that collects enough of the chosen reaction (⭐ by default) is copied into the
// starboard channel; the counter on the copy follows later reactions. Bots and (unless allowed) the author's own reaction
// do not count. Messages from age-restricted channels go only to an age-restricted starboard.
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const { StarboardEntry } = require('../../db');
const { getOrCreateSettings } = require('./leveling');
const { isEnabled } = require('../utils/features');
const { withLock } = require('../utils/lock');
const logger = require('../utils/logger');

/** The emoji setting as a key comparable with a reaction: custom emoji → its id, unicode → itself. */
function emojiKey(value) {
  const s = String(value || '⭐').trim();
  const custom = s.match(/^<a?:\w+:(\d+)>$/);
  return custom ? custom[1] : s;
}
const reactionKey = (emoji) => (emoji.id ? emoji.id : emoji.name);

/** Whether ordinary members (@everyone) can see a channel. Unknown (no permission data) counts as visible. */
function everyoneSees(channel) {
  const everyone = channel?.guild?.roles?.everyone;
  if (!channel?.permissionsFor || !everyone) return true;
  return Boolean(channel.permissionsFor(everyone)?.has?.(PermissionFlagsBits.ViewChannel));
}

function starLabel(count, emoji) {
  return `${String(emoji || '⭐').trim()} **${count}**`;
}

function buildPost(message, count, emoji) {
  const e = new EmbedBuilder()
    .setColor(0xe3a857)
    .setAuthor({ name: message.member?.displayName || message.author?.username || 'Участник', iconURL: message.author?.displayAvatarURL?.() || undefined })
    .setDescription(String(message.content || '').slice(0, 4000) || null)
    .setTimestamp(message.createdAt || new Date());
  const image = [...(message.attachments?.values?.() || [])].find((a) => /^image\//.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
  if (image) e.setImage(image.url);
  const files = [...(message.attachments?.values?.() || [])].filter((a) => a !== image).slice(0, 5);
  if (files.length) e.addFields({ name: 'Вложения', value: files.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1000) });
  const link = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('К сообщению').setURL(message.url);
  return { content: `${starLabel(count, emoji)} · <#${message.channelId}>`, embeds: [e], components: [new ActionRowBuilder().addComponents(link)], allowedMentions: { parse: [] } };
}

/** How many people (not bots, not the author unless allowed) reacted with the starboard emoji. */
async function countStars(reaction, message, selfStar) {
  const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
  if (!users) return Math.max(0, (reaction.count || 0));
  return [...users.values()].filter((u) => !u.bot && (selfStar || u.id !== message.author?.id)).length;
}

/** Called for every reaction added or removed. Never throws. */
async function handleStarReaction(reaction, user) {
  try {
    if (user?.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    let message = reaction.message;
    if (!message?.guild) return;
    const settings = await getOrCreateSettings(message.guild.id);
    if (!settings.starboardChannelId || !isEnabled(settings, 'starboard')) return;
    if (reactionKey(reaction.emoji) !== emojiKey(settings.starboardEmoji)) return;
    if (message.channelId === settings.starboardChannelId) return; // reactions on the board itself
    if (message.partial) message = await message.fetch().catch(() => null);
    if (!message) return;

    await withLock(`starboard:${message.id}`, async () => {
      const board = message.guild.channels.cache.get(settings.starboardChannelId) || (await message.guild.channels.fetch(settings.starboardChannelId).catch(() => null));
      if (!board?.send) return;
      if (message.channel?.nsfw && !board.nsfw) return;
      // A closed channel (staff, admins) must not leak onto a board everyone can read.
      if (everyoneSees(board) && !everyoneSees(message.channel)) return;
      const count = await countStars(reaction, message, Boolean(settings.starboardSelfStar));
      const threshold = Math.max(1, Number(settings.starboardThreshold) || 3);
      const entry = await StarboardEntry.findOne({ where: { messageId: message.id } });
      if (entry) {
        if (entry.count === count) return;
        entry.count = count;
        await entry.save();
        const copy = entry.starMessageId ? await board.messages.fetch(entry.starMessageId).catch(() => null) : null;
        if (copy) await copy.edit({ content: `${starLabel(count, settings.starboardEmoji)} · <#${message.channelId}>`, allowedMentions: { parse: [] } }).catch(() => {});
        return;
      }
      if (count < threshold) return;
      const sent = await board.send(buildPost(message, count, settings.starboardEmoji));
      await StarboardEntry.create({ guildId: message.guild.id, messageId: message.id, channelId: message.channelId, authorId: message.author?.id || null, starMessageId: sent?.id || null, count });
    });
  } catch (err) {
    logger.warn(`Starboard: ${err.message}`);
  }
}

module.exports = { handleStarReaction, emojiKey, buildPost, countStars };
