const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild } = require('../../discordApi');
const { Alert } = require('../../../db');
const { snowflake, saved } = require('../../utils/common');

const router = express.Router();
const MAX_ALERTS = 25;
const ALERT_CHANNEL_TYPES = [0, 5];

// ---- Alerts (YouTube / Twitch) ----
router.get('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const [guild, channels] = await Promise.all([getGuild(req.params.guildId), getGuildChannels(req.params.guildId)]);
  const alerts = await Alert.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/alerts', { guild, channels, alerts, active: 'alerts' });
});

router.post('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const { platform, targetId, channelId, message } = req.body;
  // YouTube channel IDs are case-sensitive; Twitch logins are not.
  const rawTarget = (targetId || '').trim().slice(0, 100);
  const target = platform === 'twitch' ? rawTarget.toLowerCase() : rawTarget;
  if (platform === 'youtube' && !/^UC[\w-]{20,}$/.test(target)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
  }
  if (platform === 'twitch' && !/^[a-z0-9_]{3,25}$/.test(target)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'badlogin'));
  }
  if (!['youtube', 'twitch'].includes(platform) || !target || !snowflake(channelId)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
  }
  // Only a text or announcement channel of this server.
  const channels = await getGuildChannels(req.params.guildId);
  if (!channels.some((c) => c.id === channelId && ALERT_CHANNEL_TYPES.includes(c.type))) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'badchannel'));
  }
  // A limit per server: every subscription costs requests to YouTube/Twitch that all servers share.
  const exists = await Alert.findOne({ where: { guildId: req.params.guildId, platform, targetId: target } });
  if (!exists && (await Alert.count({ where: { guildId: req.params.guildId } })) >= MAX_ALERTS) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'toomany'));
  }
  await Alert.upsert({
    guildId: req.params.guildId,
    platform,
    targetId: target,
    channelId: snowflake(channelId),
    message: (message || '').trim().slice(0, 1000) || undefined
  });
  res.redirect(saved(req.params.guildId, 'alerts'));
});

router.post('/:guildId/alerts/delete/:id', ensureGuildAccess, async (req, res) => {
  await Alert.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'alerts', 'deleted'));
});

module.exports = router;
