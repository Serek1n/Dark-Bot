const express = require('express');
const { ensureAuth } = require('../middleware/ensureAuth');
const { ensureGuildAccess } = require('../middleware/ensureGuildAccess');
const { getBotGuildIds, getGuildChannels, getGuildRoles, getGuild, getUsers } = require('../discordApi');
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

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseWords(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Discord IDs from forms: accept only real snowflakes (or empty = "not set").
const snowflake = (v) => (/^\d{15,25}$/.test(String(v || '').trim()) ? String(v).trim() : null);

const saved = (guildId, page, flag = 'saved') => `/dashboard/${guildId}/${page}?${flag}=1`;
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
  const reactionRoleCount = await ReactionRole.count({ where: { guildId: req.params.guildId } });
  const customCommandCount = await CustomCommand.count({ where: { guildId: req.params.guildId } });
  const alertCount = await Alert.count({ where: { guildId: req.params.guildId } });
  res.render('dashboard/overview', {
    guild,
    settings,
    memberCount,
    warningCount,
    reactionRoleCount,
    customCommandCount,
    alertCount,
    active: 'overview'
  });
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
  const min = clampInt(req.body.xpPerMessageMin, 1, 1000, settings.xpPerMessageMin);
  const max = clampInt(req.body.xpPerMessageMax, 1, 1000, settings.xpPerMessageMax);
  settings.xpPerMessageMin = Math.min(min, max);
  settings.xpPerMessageMax = Math.max(min, max);
  settings.xpCooldownSeconds = clampInt(req.body.xpCooldownSeconds, 0, 3600, settings.xpCooldownSeconds);
  settings.levelUpChannelId = snowflake(req.body.levelUpChannelId);
  settings.currencyName = (req.body.currencyName || '').trim().slice(0, 24) || settings.currencyName;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'leveling'));
});

// ---- Leaderboard (read-only) ----
router.get('/:guildId/leaderboard', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const top = await MemberProfile.findAll({ where: { guildId: req.params.guildId }, order: [['xp', 'DESC']], limit: 50 });
  const users = await getUsers(top.map((p) => p.userId));
  res.render('dashboard/leaderboard', { guild, top, users, active: 'leaderboard' });
});

// ---- Moderation: log channel, report channel, mod log + warnings viewer ----
router.get('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const logs = await ModLog.findAll({ where: { guildId: req.params.guildId }, order: [['createdAt', 'DESC']], limit: 50 });
  const users = await getUsers(logs.flatMap((l) => [l.userId, l.moderatorId]));
  res.render('dashboard/moderation', { guild, settings, channels, logs, users, active: 'moderation' });
});

router.post('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modLogChannelId = snowflake(req.body.modLogChannelId);
  settings.reportChannelId = snowflake(req.body.reportChannelId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation'));
});

// ---- Automod ----
router.get('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const bannedWords = parseWords(settings.automodBannedWords);
  res.render('dashboard/automod', { guild, settings, bannedWords, active: 'automod' });
});

router.post('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.automodEnabled = req.body.automodEnabled === 'on';
  settings.automodBlockInvites = req.body.automodBlockInvites === 'on';
  settings.automodAntiSpam = req.body.automodAntiSpam === 'on';
  settings.automodSpamMessages = clampInt(req.body.automodSpamMessages, 2, 30, settings.automodSpamMessages);
  settings.automodSpamSeconds = clampInt(req.body.automodSpamSeconds, 2, 60, settings.automodSpamSeconds);
  const words = [
    ...new Set(
      (req.body.bannedWords || '')
        .split(/\r?\n/)
        .map((w) => w.trim().toLowerCase().slice(0, 64))
        .filter(Boolean)
    )
  ].slice(0, 500);
  settings.automodBannedWords = JSON.stringify(words);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'automod'));
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
  settings.welcomeChannelId = snowflake(req.body.welcomeChannelId);
  settings.welcomeMessage = (req.body.welcomeMessage || '').trim().slice(0, 1800) || settings.welcomeMessage;
  settings.autoRoleId = snowflake(req.body.autoRoleId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'welcome'));
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
  res.redirect(saved(req.params.guildId, 'reaction-roles', 'deleted'));
});

// ---- Custom commands ----
router.get('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const commands = await CustomCommand.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/custom-commands', { guild, commands, active: 'custom-commands' });
});

router.post('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  // Triggers are a single word; strip the prefix if the admin typed it ("!rules" -> "rules").
  let trigger = (req.body.trigger || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (settings.prefix && trigger.startsWith(settings.prefix.toLowerCase())) trigger = trigger.slice(settings.prefix.length);
  trigger = trigger.slice(0, 32);
  const response = (req.body.response || '').trim().slice(0, 2000);
  if (!trigger || !response) return res.redirect(saved(req.params.guildId, 'custom-commands', 'invalid'));
  await CustomCommand.upsert({ guildId: req.params.guildId, trigger, response, createdBy: req.user.id });
  res.redirect(saved(req.params.guildId, 'custom-commands'));
});

router.post('/:guildId/custom-commands/delete/:id', ensureGuildAccess, async (req, res) => {
  await CustomCommand.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'custom-commands', 'deleted'));
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
  settings.tempVoiceJoinChannelId = snowflake(req.body.tempVoiceJoinChannelId);
  settings.tempVoiceCategoryId = snowflake(req.body.tempVoiceCategoryId);
  settings.tempVoiceNameTemplate = (req.body.tempVoiceNameTemplate || '').trim().slice(0, 90) || settings.tempVoiceNameTemplate;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'temp-voice'));
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
  // YouTube channel IDs are case-sensitive; Twitch logins are not.
  const rawTarget = (targetId || '').trim().slice(0, 100);
  const target = platform === 'twitch' ? rawTarget.toLowerCase() : rawTarget;
  if (platform === 'youtube' && !/^UC[\w-]{20,}$/.test(target)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
  }
  if (!['youtube', 'twitch'].includes(platform) || !target || !snowflake(channelId)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
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
