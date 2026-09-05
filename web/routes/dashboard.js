const express = require('express');
const { ensureAuth } = require('../middleware/ensureAuth');
const { ensureGuildAccess } = require('../middleware/ensureGuildAccess');
const { getBotGuildIds, getGuildChannels, getGuildRoles, getGuild } = require('../discordApi');
const {
  GuildSettings,
  MemberProfile,
  Warning,
  ModLog,
  CustomCommand,
  ReactionRole,
  Alert
} = require('../../db');

const router = express.Router();
router.use(ensureAuth);

const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;
function hasManageAccess(guild) {
  if (guild.owner) return true;
  const perms = BigInt(guild.permissions || 0);
  return (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD) || (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR);
}

// ---- Guild picker ----
router.get('/', async (req, res) => {
  const botGuildIds = await getBotGuildIds();
  const manageable = (req.user.guilds || []).filter(hasManageAccess);
  const guilds = manageable.map((g) => ({ ...g, botPresent: botGuildIds.has(g.id) }));
  res.render('guilds', { guilds });
});

async function getSettings(guildId) {
  const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
  return settings;
}

// ---- Overview ----
router.get('/:guildId', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const memberCount = await MemberProfile.count({ where: { guildId: req.params.guildId } });
  const warningCount = await Warning.count({ where: { guildId: req.params.guildId } });
  res.render('dashboard/overview', { guild, settings, memberCount, warningCount, active: 'overview' });
});

// ---- Leveling settings ----
router.get('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  res.render('dashboard/leveling', { guild, settings, channels, active: 'leveling' });
});

router.post('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelingEnabled = req.body.levelingEnabled === 'on';
  settings.xpPerMessageMin = Number(req.body.xpPerMessageMin) || settings.xpPerMessageMin;
  settings.xpPerMessageMax = Number(req.body.xpPerMessageMax) || settings.xpPerMessageMax;
  settings.xpCooldownSeconds = Number(req.body.xpCooldownSeconds) || settings.xpCooldownSeconds;
  settings.levelUpChannelId = req.body.levelUpChannelId || null;
  settings.currencyName = req.body.currencyName || settings.currencyName;
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/leveling`);
});

// ---- Leaderboard (read-only) ----
router.get('/:guildId/leaderboard', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const top = await MemberProfile.findAll({ where: { guildId: req.params.guildId }, order: [['xp', 'DESC']], limit: 50 });
  res.render('dashboard/leaderboard', { guild, top, active: 'leaderboard' });
});

// ---- Moderation: log channel, report channel, mod log + warnings viewer ----
router.get('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const logs = await ModLog.findAll({ where: { guildId: req.params.guildId }, order: [['createdAt', 'DESC']], limit: 50 });
  res.render('dashboard/moderation', { guild, settings, channels, logs, active: 'moderation' });
});

router.post('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modLogChannelId = req.body.modLogChannelId || null;
  settings.reportChannelId = req.body.reportChannelId || null;
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/moderation`);
});

// ---- Automod ----
router.get('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const bannedWords = JSON.parse(settings.automodBannedWords || '[]');
  res.render('dashboard/automod', { guild, settings, bannedWords, active: 'automod' });
});

router.post('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.automodEnabled = req.body.automodEnabled === 'on';
  settings.automodBlockInvites = req.body.automodBlockInvites === 'on';
  settings.automodAntiSpam = req.body.automodAntiSpam === 'on';
  settings.automodSpamMessages = Number(req.body.automodSpamMessages) || settings.automodSpamMessages;
  settings.automodSpamSeconds = Number(req.body.automodSpamSeconds) || settings.automodSpamSeconds;
  const words = (req.body.bannedWords || '')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  settings.automodBannedWords = JSON.stringify(words);
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/automod`);
});

// ---- Welcome & autorole ----
router.get('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const roles = await getGuildRoles(req.params.guildId);
  res.render('dashboard/welcome', { guild, settings, channels, roles, active: 'welcome' });
});

router.post('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.welcomeChannelId = req.body.welcomeChannelId || null;
  settings.welcomeMessage = req.body.welcomeMessage || settings.welcomeMessage;
  settings.autoRoleId = req.body.autoRoleId || null;
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/welcome`);
});

// ---- Reaction roles ----
router.get('/:guildId/reaction-roles', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const roles = await getGuildRoles(req.params.guildId);
  const reactionRoles = await ReactionRole.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/reaction-roles', { guild, channels, roles, reactionRoles, active: 'reaction-roles' });
});

router.post('/:guildId/reaction-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await ReactionRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(`/dashboard/${req.params.guildId}/reaction-roles`);
});

// ---- Custom commands ----
router.get('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const commands = await CustomCommand.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/custom-commands', { guild, commands, active: 'custom-commands' });
});

router.post('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const trigger = (req.body.trigger || '').trim().toLowerCase();
  const response = (req.body.response || '').trim();
  if (trigger && response) {
    await CustomCommand.upsert({ guildId: req.params.guildId, trigger, response, createdBy: req.user.id });
  }
  res.redirect(`/dashboard/${req.params.guildId}/custom-commands`);
});

router.post('/:guildId/custom-commands/delete/:id', ensureGuildAccess, async (req, res) => {
  await CustomCommand.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(`/dashboard/${req.params.guildId}/custom-commands`);
});

// ---- Temp voice ----
router.get('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  res.render('dashboard/temp-voice', { guild, settings, channels, active: 'temp-voice' });
});

router.post('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.tempVoiceJoinChannelId = req.body.tempVoiceJoinChannelId || null;
  settings.tempVoiceCategoryId = req.body.tempVoiceCategoryId || null;
  settings.tempVoiceNameTemplate = req.body.tempVoiceNameTemplate || settings.tempVoiceNameTemplate;
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/temp-voice`);
});

// ---- Alerts (YouTube / Twitch) ----
router.get('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const alerts = await Alert.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/alerts', { guild, channels, alerts, active: 'alerts' });
});

router.post('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const { platform, targetId, channelId, message } = req.body;
  if (platform && targetId && channelId) {
    await Alert.upsert({
      guildId: req.params.guildId,
      platform,
      targetId: targetId.trim().toLowerCase(),
      channelId,
      message: message || undefined
    });
  }
  res.redirect(`/dashboard/${req.params.guildId}/alerts`);
});

router.post('/:guildId/alerts/delete/:id', ensureGuildAccess, async (req, res) => {
  await Alert.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(`/dashboard/${req.params.guildId}/alerts`);
});

module.exports = router;
