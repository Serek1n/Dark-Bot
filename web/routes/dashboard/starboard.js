const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, getUsers } = require('../../discordApi');
const { StarboardEntry } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();
const BOARD_TYPES = [0, 5];

// ---- "Доска почёта" (starboard) ----
router.get('/:guildId/starboard', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId)]);
  const top = await StarboardEntry.findAll({ where: { guildId }, order: [['count', 'DESC'], ['id', 'DESC']], limit: 10 });
  const users = await getUsers([...new Set(top.map((t) => t.authorId).filter(Boolean))]);
  res.render('dashboard/starboard', { guild, settings, channels: channels.filter((c) => BOARD_TYPES.includes(c.type)), allChannels: channels, top, users, active: 'starboard' });
});

router.post('/:guildId/starboard', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const channelId = snowflake(req.body.starboardChannelId);
  if (channelId && !(await getGuildChannels(guildId)).some((c) => c.id === channelId && BOARD_TYPES.includes(c.type))) return res.redirect(saved(guildId, 'starboard', 'badchannel'));
  // One emoji: a unicode emoji (a few characters) or a custom one written as <:name:id>.
  const emoji = String(req.body.starboardEmoji || '').trim();
  const okEmoji = /^<a?:\w{2,32}:\d{15,25}>$/.test(emoji) || (emoji.length > 0 && emoji.length <= 16 && !/[\s<>@#:]/.test(emoji) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji));
  if (emoji && !okEmoji) return res.redirect(saved(guildId, 'starboard', 'invalid'));
  settings.starboardChannelId = channelId;
  settings.starboardEmoji = emoji || '⭐';
  settings.starboardThreshold = clampInt(req.body.starboardThreshold, 1, 100, 3);
  settings.starboardSelfStar = req.body.starboardSelfStar === 'on';
  await settings.save();
  res.redirect(saved(guildId, 'starboard'));
});

module.exports = router;
