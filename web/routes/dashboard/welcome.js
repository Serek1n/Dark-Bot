const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild } = require('../../discordApi');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Welcome & autorole ----
router.get('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels, roles] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId)]);
  res.render('dashboard/welcome', { guild, settings, channels, roles, active: 'welcome' });
});

router.post('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.welcomeChannelId = snowflake(req.body.welcomeChannelId);
  settings.welcomeMessage = (req.body.welcomeMessage || '').trim().slice(0, 1800) || settings.welcomeMessage;
  settings.welcomeCard = req.body.welcomeCard === 'on';
  settings.leaveChannelId = snowflake(req.body.leaveChannelId);
  settings.leaveMessage = (req.body.leaveMessage || '').trim().slice(0, 1800) || settings.leaveMessage;
  settings.autoRoleId = snowflake(req.body.autoRoleId);
  settings.restoreOnRejoin = req.body.restoreOnRejoin === 'on';
  settings.restoreDays = clampInt(req.body.restoreDays, 1, 3650, 365);
  settings.restoreStaffRoles = req.body.restoreStaffRoles === 'on';
  await settings.save();
  res.redirect(saved(req.params.guildId, 'welcome'));
});

module.exports = router;
