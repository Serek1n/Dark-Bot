const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getBotGuilds, getGuild, getUsers } = require('../../discordApi');
const { GuildSettings, MemberProfile, Warning, ModLog, CustomCommand, ReactionRole, Alert } = require('../../../db');
const { refreshUserGuilds } = require('../../utils/userGuilds');
const { inviteUrl } = require('../../../bot/utils/invite');
const { hasManageAccess, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Guild picker ----
router.get('/', async (req, res) => {
  const [botGuilds, userGuilds] = await Promise.all([getBotGuilds(), refreshUserGuilds(req, { force: true })]);
  const guilds = userGuilds.filter(hasManageAccess).map((g) => {
    const live = botGuilds.get(g.id); // the bot's own data has the current name and icon
    return { ...g, name: live?.name || g.name, icon: live ? live.icon : g.icon, botPresent: Boolean(live), inviteUrl: live ? null : inviteUrl(process.env.DISCORD_CLIENT_ID, g.id) };
  });
  // Servers the bot was removed from keep their data for 14 days: tell how long is left.
  const gone = await GuildSettings.findAll({ where: { guildId: guilds.filter((g) => !g.botPresent).map((g) => g.id), leftAt: { [Op.ne]: null } }, attributes: ['guildId', 'leftAt'] });
  const left = new Map(gone.map((r) => [r.guildId, r.leftAt]));
  for (const g of guilds) {
    const at = left.get(g.id);
    if (at) g.daysLeft = Math.max(0, Math.ceil((new Date(at).getTime() + 14 * 86400000 - Date.now()) / 86400000));
  }
  // Servers with the bot first, then the rest, each alphabetically.
  guilds.sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
  res.render('guilds', { guilds });
});


// ---- Overview ----
router.get('/:guildId', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  const where = { guildId: req.params.guildId };
  const [memberCount, warningCount, reactionRoleCount, customCommandCount, alertCount, topMembers, recentLogs] = await Promise.all([
    MemberProfile.count({ where }), Warning.count({ where }), ReactionRole.count({ where }), CustomCommand.count({ where }), Alert.count({ where }),
    MemberProfile.findAll({ where, order: [['xp', 'DESC']], limit: 5 }),
    ModLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 5 })
  ]);
  const users = await getUsers([...topMembers.map((p) => p.userId), ...recentLogs.flatMap((l) => [l.userId, l.moderatorId])]);
  res.render('dashboard/overview', {
    guild,
    settings,
    topMembers,
    recentLogs,
    users,
    memberCount,
    warningCount,
    reactionRoleCount,
    customCommandCount,
    alertCount,
    active: 'overview'
  });
});

module.exports = router;
