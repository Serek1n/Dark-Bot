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
    MemberProfile.findAll({ where, order: [['xp', 'DESC']], limit: 7 }),
    ModLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 7 })
  ]);
  const users = await getUsers([...topMembers.map((p) => p.userId), ...recentLogs.flatMap((l) => [l.userId, l.moderatorId])]);
  const { BY_KEY, moduleStats } = require('../../modules');
  const stats = await moduleStats(req.params.guildId);
  const selected = BY_KEY.has(String(req.query.m || '')) ? String(req.query.m) : null;
  // "Требует внимания": what an admin should look at now, most urgent first; empty = all is well.
  const mods = res.locals.mods;
  const on = (k) => !mods || (mods.list.find((m) => m.key === k) || {}).on !== false;
  const first = (k) => (stats[k] && stats[k][0] ? Number(stats[k][0].value) || 0 : 0);
  const g = `/dashboard/${req.params.guildId}`;
  const attention = [];
  if (res.locals.sys && !res.locals.sys.botOnline) attention.push({ level: 'bad', icon: 'moderation', text: 'Бот не в сети: команды и автоматические действия не работают', href: `${g}/changelog` });
  if (on('report') && first('report')) attention.push({ level: 'warn', icon: 'report', text: `Новых жалоб: ${first('report')}`, href: `${g}/moderation` });
  if (on('tickets') && first('tickets')) attention.push({ level: 'warn', icon: 'tickets', text: `Открытых обращений: ${first('tickets')}`, href: `${g}?m=tickets` });
  if (on('moderation') && !settings.modLogChannelId) attention.push({ level: 'info', icon: 'moderation', text: 'Не выбран канал журнала наказаний', href: `${g}/moderation` });
  if (on('logs') && !settings.logForumChannelId) attention.push({ level: 'info', icon: 'logs', text: 'Логи сервера не настроены', href: `${g}/logs` });
  if (on('welcome') && settings.welcomeEnabled && !settings.welcomeChannelId && !settings.autoRoleId) attention.push({ level: 'info', icon: 'welcome', text: 'Приветствие включено, но канал не выбран', href: `${g}/welcome` });
  const offCount = mods ? mods.list.filter((m) => !m.on).length : 0;
  if (offCount) attention.push({ level: 'info', icon: 'modules', text: `Выключено модулей: ${offCount}`, href: `${g}/features` });
  // The latest changes, one line each, for the "О версии" card.
  const updates = require('../../../bot/modules/updates');
  const releases = updates.releases().slice(0, 2).map((r) => updates.inLang(r, req.lang)).map((r) => ({
    date: String(r.date || '').split('-').reverse().slice(0, 2).join('.'),
    text: [...(r.panelChanges || []), ...(r.botChanges || [])][0] || ''
  })).filter((r) => r.text);
  res.render('dashboard/overview', {
    attention,
    releases,
    stats,
    selected,
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
