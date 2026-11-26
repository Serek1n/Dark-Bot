// The bot's look on one server («Базовые настройки» → «Ответы бота», GuildSettings.brandConfig): the colours of the
// replies by kind (information, success, warning, error, moderation), the marks of success and error, a footer, the
// style of dates (<t:…>), and private answers of the information commands. Applied to every reply of a slash command
// as it goes out (wrap(interaction)), so no command has to know about it.
const { MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const mc = require('../utils/moduleConfig');

// commands that only show something to the one who asked: private by default when the server wants it
const INFO_COMMANDS = new Set(['help', 'info', 'stats', 'profile', 'balance', 'top', 'level', 'calc', 'achievements', 'Profile']);
const TTL = 30_000;
const cache = new Map(); // guildId → { at, brand }

async function forGuild(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.brand;
  const { GuildSettings } = require('../../db');
  const brand = mc.read(await GuildSettings.findByPk(guildId).catch(() => null), 'brand');
  cache.set(guildId, { at: Date.now(), brand });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return brand;
}
const forget = (guildId) => cache.delete(guildId);
const isDefault = (b) => !b.colorInfo && !b.colorSuccess && !b.colorWarning && !b.colorError && !b.colorMod && b.emojiSuccess === '✅' && b.emojiError === '❌' && !b.footer && !b.ephemeral && !b.dateStyle;
const hexNum = (h) => parseInt(h.slice(1), 16);

const restyleDates = (text, style) => (style && typeof text === 'string' ? text.replace(/<t:(-?\d+)(?::[tTdDfFR])?>/g, `<t:$1:${style}>`) : text);

/** One embed (an EmbedBuilder or its JSON), changed in place. kind: 'mod' for the moderation commands. */
function restyleEmbed(e, b, kind) {
  const d = e && (e.data || e);
  if (!d || typeof d !== 'object') return e;
  const map = { [COLORS.primary]: b.colorInfo, [COLORS.success]: b.colorSuccess, [COLORS.warning]: b.colorWarning, [COLORS.danger]: b.colorError };
  if (kind === 'mod' && b.colorMod) d.color = hexNum(b.colorMod);
  else if (map[d.color]) d.color = hexNum(map[d.color]);
  if (typeof d.description === 'string') {
    if (d.description.startsWith('✅ ') && b.emojiSuccess !== '✅') d.description = (b.emojiSuccess ? b.emojiSuccess + ' ' : '') + d.description.slice(2);
    else if (d.description.startsWith('❌ ') && b.emojiError !== '❌') d.description = (b.emojiError ? b.emojiError + ' ' : '') + d.description.slice(2);
    d.description = restyleDates(d.description, b.dateStyle);
  }
  if (Array.isArray(d.fields) && b.dateStyle) d.fields.forEach((f) => { f.value = restyleDates(f.value, b.dateStyle); });
  if (b.footer && !(d.footer && d.footer.text)) d.footer = { text: b.footer };
  return e;
}

/** A reply payload in the server's look. command: the command's name (private answers, moderation colour). */
function apply(payload, b, command, first = true) {
  if (!payload || typeof payload !== 'object' || isDefault(b)) return payload;
  const kind = command === 'mod' ? 'mod' : '';
  if (Array.isArray(payload.embeds)) payload.embeds.forEach((e) => restyleEmbed(e, b, kind));
  if (typeof payload.content === 'string') payload.content = restyleDates(payload.content, b.dateStyle);
  if (first && b.ephemeral && INFO_COMMANDS.has(command) && payload.flags === undefined) payload.flags = MessageFlags.Ephemeral;
  return payload;
}

/** Every reply of this command goes out in the server's look. */
async function wrap(interaction) {
  if (!interaction.guildId) return;
  const b = await forGuild(interaction.guildId);
  if (isDefault(b)) return;
  const name = interaction.commandName;
  for (const fn of ['reply', 'editReply', 'followUp']) {
    const orig = interaction[fn];
    if (typeof orig !== 'function') continue;
    interaction[fn] = function (p) { return orig.call(this, typeof p === 'string' ? p : apply(p, b, name, fn === 'reply')); };
  }
}

module.exports = { forGuild, forget, apply, wrap, restyleEmbed, restyleDates, INFO_COMMANDS, isDefault };
