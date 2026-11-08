const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild } = require('../../discordApi');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');
const { embedFromBody } = require('../../utils/embedForm');

const { pickChannels, noPerm } = require('../../utils/channels');
const router = express.Router();

// ---- Welcome & autorole ----
router.get('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels, allRoles, guard] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId), roleGuard(req.params.guildId, req.user?.id)]);
  const roles = guard.annotate(allRoles);
  res.render('dashboard/welcome', { guild, settings, channels, roles, active: 'welcome' });
});

router.post('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.welcomeEmbed = embedFromBody(req.body, 'welcomeEmbed');
  settings.leaveEmbed = embedFromBody(req.body, 'leaveEmbed');
  // the text may be left empty when the embed says everything
  settings.welcomeMessage = (req.body.welcomeMessage || '').trim().slice(0, 1800) || (settings.welcomeEmbed ? '' : settings.welcomeMessage);
  settings.welcomeCard = req.body.welcomeCard === 'on';
  const missing = await pickChannels(req.body, settings, req.params.guildId, { welcomeChannelId: settings.welcomeCard ? 'card' : 'post', leaveChannelId: 'post' });
  settings.leaveMessage = (req.body.leaveMessage || '').trim().slice(0, 1800) || (settings.leaveEmbed ? '' : settings.leaveMessage);
  // A new autorole must be one this user may hand out; an unchanged one stays as it is.
  const autoRoleId = snowflake(req.body.autoRoleId);
  if (autoRoleId && autoRoleId !== settings.autoRoleId && (await roleGuard(req.params.guildId, req.user?.id)).check(autoRoleId)) {
    return res.redirect(saved(req.params.guildId, 'welcome', 'rolenotallowed'));
  }
  settings.autoRoleId = autoRoleId;
  settings.restoreOnRejoin = req.body.restoreOnRejoin === 'on';
  settings.restoreDays = clampInt(req.body.restoreDays, 1, 3650, 365);
  settings.restoreStaffRoles = req.body.restoreStaffRoles === 'on';
  await settings.save();
  res.redirect(missing.length ? noPerm(req.params.guildId, 'welcome', missing) : saved(req.params.guildId, 'welcome'));
});

module.exports = router;
