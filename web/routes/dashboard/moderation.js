const express = require('express');
const { Op } = require('sequelize');
const { PermissionFlagsBits: P } = require('discord.js');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, getUsers } = require('../../discordApi');
const { ModLog, Warning, Report } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');
const { pickChannels, noPerm } = require('../../utils/channels');
const { getClient } = require('../../botBridge');

// «Наказания» — one module with tabs: overview, active punishments, warnings, automatic punishments, reports (the former
// module «Жалобы», same data and switch), the log and the settings. The old addresses (/moderation, /moderation/rules)
// keep working.
const router = express.Router();
const mod = () => require('../../../bot/modules/moderation');
const { formatDuration } = require('../../../bot/utils/duration');
const ACTIONS = ['warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'automod', 'note'];
const textChannels = (channels) => channels.filter((c) => c.type === 0 || c.type === 5);
const base = (req, page, extra) => ({ guild: extra.guild, settings: extra.settings, formatDuration, active: page, ...extra });

/** What the bot may do on this server, in words: its permissions and how high its role is. Null when the bot is not here. */
function botReadiness(guildId) {
  const g = getClient()?.guilds?.cache?.get(guildId);
  const me = g?.members?.me;
  if (!me) return null;
  const has = (f) => Boolean(me.permissions?.has?.(f));
  const top = me.roles?.highest;
  const above = top ? [...g.roles.cache.values()].filter((r) => r.id !== g.id && r.comparePositionTo(top) > 0 && !r.managed).sort((a, b) => b.position - a.position) : [];
  return {
    perms: [['Тайм-аут (мут)', has(P.ModerateMembers)], ['Выгонять', has(P.KickMembers)], ['Банить', has(P.BanMembers)], ['Управлять сообщениями', has(P.ManageMessages)]],
    role: top ? top.name : null,
    above: above.slice(0, 8).map((r) => r.name),
    aboveCount: above.length
  };
}

// ---- Обзор ----
router.get('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const week = new Date(Date.now() - 7 * 86400000);
  const [warns, cases7, openReports, tempBans, recent, reports] = await Promise.all([
    Warning.count({ where: { guildId, revokedAt: null } }),
    ModLog.count({ where: { guildId, createdAt: { [Op.gte]: week } } }),
    Report.count({ where: { guildId, status: 'open' } }),
    ModLog.count({ where: { guildId, action: 'ban', active: true } }),
    ModLog.findAll({ where: { guildId }, order: [['createdAt', 'DESC']], limit: 6 }),
    Report.findAll({ where: { guildId, status: 'open' }, order: [['createdAt', 'DESC']], limit: 5 })
  ]);
  const failedAuto = await Warning.count({ where: { guildId, autoAction: { [Op.like]: '%"status":"failed"%' }, createdAt: { [Op.gte]: week } } });
  const users = await getUsers([...new Set(recent.flatMap((l) => [l.userId, l.moderatorId]).concat(reports.flatMap((r) => [r.targetId, r.reporterId])))]);
  const { parseThresholds } = mod();
  res.render('dashboard/moderation', base(req, 'moderation', {
    guild, settings, users, recent, reports, ready: botReadiness(guildId), thresholds: parseThresholds(settings.modWarnThresholds),
    stats: { warns, cases7, openReports, tempBans, failedAuto }
  }));
});

// ---- Наказания: what is running now (temporary bans, mutes that have not run out) ----
router.get('/:guildId/moderation-punishments', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const now = Date.now();
  const [bans, mutes] = await Promise.all([
    ModLog.findAll({ where: { guildId, action: 'ban', active: true }, order: [['expiresAt', 'ASC']], limit: 100 }),
    ModLog.findAll({ where: { guildId, action: 'mute', createdAt: { [Op.gte]: new Date(now - 28 * 86400000) } }, order: [['createdAt', 'DESC']], limit: 300 })
  ]);
  // a mute counts while its time has not run out and no unmute came after it
  const unmutes = await ModLog.findAll({ where: { guildId, action: 'unmute', createdAt: { [Op.gte]: new Date(now - 28 * 86400000) } }, attributes: ['userId', 'createdAt'] });
  const seen = new Set();
  const running = mutes.filter((m) => {
    const end = new Date(m.createdAt).getTime() + Number(m.duration || 0);
    if (end <= now || seen.has(m.userId)) return false;
    if (unmutes.some((u) => u.userId === m.userId && new Date(u.createdAt) > new Date(m.createdAt))) return false;
    seen.add(m.userId); return true;
  }).map((m) => ({ ...m.get(), endsAt: new Date(new Date(m.createdAt).getTime() + Number(m.duration || 0)) }));
  const permBans = await ModLog.findAll({ where: { guildId, action: 'ban', active: false, duration: null }, order: [['createdAt', 'DESC']], limit: 30 });
  const users = await getUsers([...new Set([...bans, ...running, ...permBans].flatMap((l) => [l.userId, l.moderatorId]))]);
  res.render('dashboard/moderation-punishments', base(req, 'moderation-punishments', { guild, settings, bans, mutes: running, permBans, users, modfail: String(req.query.modfail || '').slice(0, 300) }));
});

// Lifting a running punishment from the panel: the bot does it in Discord and writes the case.
router.post('/:guildId/moderation-punishments/lift', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  const kind = req.body.kind === 'ban' ? 'ban' : 'mute';
  const g = getClient()?.guilds?.cache?.get(guildId);
  if (!userId || !g) return res.redirect(saved(guildId, 'moderation-punishments', 'invalid'));
  const reason = `Снято в панели${req.user?.username ? ` (${req.user.username})` : ''}`;
  try {
    if (kind === 'ban') await mod().unbanUser(g, userId, { moderatorId: req.user?.id || g.client.user.id, reason });
    else {
      const member = await g.members.fetch(userId).catch(() => null);
      if (!member) return res.redirect(saved(guildId, 'moderation-punishments', 'notmember'));
      const why = mod().whyCannot(g, member, 'unmute');
      if (why) return res.redirect(`/dashboard/${guildId}/moderation-punishments?modfail=${encodeURIComponent(why)}`);
      await member.timeout(null, reason);
      await require('../../../bot/utils/modlog').recordAndAnnounce(g, { userId, moderatorId: req.user?.id || g.client.user.id, action: 'unmute', reason });
    }
  } catch (err) {
    return res.redirect(`/dashboard/${guildId}/moderation-punishments?modfail=${encodeURIComponent(require('../../../bot/utils/punishable').apiErrorText(err, kind === 'ban' ? 'ban' : 'unmute'))}`);
  }
  res.redirect(saved(guildId, 'moderation-punishments', 'lifted'));
});

// ---- Предупреждения ----
router.get('/:guildId/moderation-warnings', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const f = { state: ['active', 'revoked', 'all'].includes(req.query.state) ? req.query.state : 'active', user: snowflake(req.query.user) || '', auto: req.query.auto === 'failed' ? 'failed' : '' };
  const where = { guildId };
  if (f.state === 'active') where.revokedAt = null;
  if (f.state === 'revoked') where.revokedAt = { [Op.ne]: null };
  if (f.user) where.userId = f.user;
  if (f.auto) where.autoAction = { [Op.like]: '%"status":"failed"%' };
  const page = clampInt(req.query.page, 0, 1000, 0);
  const [rows, total] = await Promise.all([Warning.findAll({ where, order: [['id', 'DESC']], limit: 50, offset: page * 50 }), Warning.count({ where })]);
  const users = await getUsers([...new Set(rows.flatMap((w) => [w.userId, w.moderatorId, w.revokedBy].filter(Boolean)))]);
  const parse = (t) => { try { return JSON.parse(t || 'null'); } catch { return null; } };
  const expireDays = Number(settings.modWarnExpireDays) || 0;
  res.render('dashboard/moderation-warnings', base(req, 'moderation-warnings', {
    guild, settings, users, total, page, f, expireDays,
    rows: rows.map((w) => ({ ...w.get(), auto: parse(w.autoAction), expired: expireDays > 0 && new Date(w.createdAt) < new Date(Date.now() - expireDays * 86400000) })),
    describe: (a) => (a ? mod().describeEscalation(a) : null), punishmentName: mod().punishmentName
  }));
});

router.post('/:guildId/moderation-warnings/:id/revoke', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const w = await Warning.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!w) return res.redirect(saved(guildId, 'moderation-warnings', 'invalid'));
  const reason = String(req.body.reason || '').trim().slice(0, 200) || 'Снято в панели';
  if (!(await mod().revokeWarning(w, { by: req.user?.id || 'panel', reason }))) return res.redirect(saved(guildId, 'moderation-warnings', 'already'));
  const g = getClient()?.guilds?.cache?.get(guildId);
  if (g) await require('../../../bot/utils/modlog').recordAndAnnounce(g, { userId: w.userId, moderatorId: req.user?.id || g.client.user.id, action: 'unwarn', reason: `Снято предупреждение #${w.id}: ${reason}` }).catch(() => {});
  res.redirect(saved(guildId, 'moderation-warnings', 'unwarned'));
});

// ---- Автонаказания ----
router.get('/:guildId/moderation-auto', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const week = new Date(Date.now() - 30 * 86400000);
  const recent = await Warning.findAll({ where: { guildId, autoAction: { [Op.ne]: null }, createdAt: { [Op.gte]: week } }, order: [['id', 'DESC']], limit: 20 });
  const users = await getUsers([...new Set(recent.map((w) => w.userId))]);
  const parse = (t) => { try { return JSON.parse(t || 'null'); } catch { return null; } };
  res.render('dashboard/moderation-auto', base(req, 'moderation-auto', {
    guild, settings, users, thresholds: mod().parseThresholds(settings.modWarnThresholds), ready: botReadiness(guildId),
    recent: recent.map((w) => ({ id: w.id, userId: w.userId, createdAt: w.createdAt, auto: parse(w.autoAction) })), describe: (a) => mod().describeEscalation(a)
  }));
});

/** Saves the "N warnings -> action" rows from the form. */
function saveThresholds(settings, body) {
  const list = (v) => [].concat(v ?? []);
  const counts = list(body.thrCount), acts = list(body.thrAction), mins = list(body.thrMinutes);
  const { parseThresholds, ESCALATION_ACTIONS } = mod();
  const rows = counts.map((c, i) => ({ count: clampInt(c, 0, 100, 0), action: ESCALATION_ACTIONS.includes(acts[i]) ? acts[i] : 'mute', minutes: clampInt(mins[i], 0, 40320 * 52, 0) }));
  // One rule per number of warnings (the last one wins); mutes are limited by Discord to 28 days.
  const byCount = new Map(rows.filter((r) => r.count >= 1).map((r) => [r.count, { ...r, minutes: r.action === 'mute' ? Math.min(Math.max(r.minutes, 1), 40320) : r.action === 'kick' ? 0 : r.minutes }]));
  settings.modWarnThresholds = JSON.stringify(parseThresholds(JSON.stringify([...byCount.values()])));
}

router.post('/:guildId/moderation/auto', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modEscalateNeedsPerm = req.body.modEscalateNeedsPerm === 'on';
  settings.modWarnExpireDays = clampInt(req.body.modWarnExpireDays, 0, 365, settings.modWarnExpireDays);
  saveThresholds(settings, req.body);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation-auto'));
});

// ---- Жалобы (the former module) ----
router.get('/:guildId/moderation-reports', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId)]);
  const status = ['open', 'done', 'ignored', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const where = status === 'all' ? { guildId } : { guildId, status };
  const [rows, counts] = await Promise.all([
    Report.findAll({ where, order: [['id', 'DESC']], limit: 50 }),
    Promise.all(['open', 'done', 'ignored'].map((s) => Report.count({ where: { guildId, status: s } })))
  ]);
  const users = await getUsers([...new Set(rows.flatMap((r) => [r.targetId, r.reporterId, r.handledBy].filter(Boolean)))]);
  const { CATEGORIES } = require('../../../bot/modules/reports');
  res.render('dashboard/moderation-reports', base(req, 'moderation-reports', { guild, settings, channels: textChannels(channels), rows, users, status, counts: { open: counts[0], done: counts[1], ignored: counts[2] }, CATEGORIES }));
});

router.post('/:guildId/moderation/reports', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const missing = await pickChannels(req.body, settings, req.params.guildId, { reportChannelId: 'post' });
  settings.reportDailyLimit = clampInt(req.body.reportDailyLimit, 1, 50, 5);
  settings.reportJoinAlert = req.body.reportJoinAlert === 'on';
  await settings.save();
  res.redirect(missing.length ? noPerm(req.params.guildId, 'moderation-reports', missing) : saved(req.params.guildId, 'moderation-reports'));
});

// Closing a report from the panel without a punishment: the message in Discord loses its buttons.
router.post('/:guildId/moderation-reports/:id/ignore', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const r = await Report.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!r || r.status !== 'open') return res.redirect(saved(guildId, 'moderation-reports', 'invalid'));
  // only an open report is closed: two admins pressing at once close it once
  const [n] = await Report.update({ status: 'ignored', decision: 'Отклонена в панели', handledBy: req.user?.id || null }, { where: { id: r.id, status: 'open' } });
  if (n) await require('../../../bot/modules/reports').refreshReportMessage?.(await Report.findByPk(r.id)).catch(() => {});
  res.redirect(saved(guildId, 'moderation-reports', 'reportclosed'));
});

// ---- Журнал ----
router.get('/:guildId/moderation-log', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const action = ACTIONS.includes(req.query.action) ? req.query.action : '';
  const user = snowflake(req.query.user) || '';
  const page = clampInt(req.query.page, 0, 1000, 0);
  const where = { guildId };
  if (action) where.action = action;
  if (user) where[Op.or] = [{ userId: user }, { moderatorId: user }];
  const [logs, total] = await Promise.all([ModLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 50, offset: page * 50 }), ModLog.count({ where })]);
  const users = await getUsers(logs.flatMap((l) => [l.userId, l.moderatorId]));
  res.render('dashboard/moderation-log', base(req, 'moderation-log', { guild, settings, logs, users, action, user, page, total }));
});

// ---- Настройки ----
router.get('/:guildId/moderation-settings', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  res.render('dashboard/moderation-settings', base(req, 'moderation-settings', { guild, settings, channels: textChannels(channels), ready: botReadiness(req.params.guildId) }));
});

router.post('/:guildId/moderation/settings', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const missing = await pickChannels(req.body, settings, req.params.guildId, { modLogChannelId: 'post' });
  settings.modDmEnabled = req.body.modDmEnabled === 'on';
  settings.modRequireReason = req.body.modRequireReason === 'on';
  await settings.save();
  res.redirect(missing.length ? noPerm(req.params.guildId, 'moderation-settings', missing) : saved(req.params.guildId, 'moderation-settings'));
});

// ---- the old forms (bookmarks, other pages): still accepted ----
router.post('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const missing = await pickChannels(req.body, settings, req.params.guildId, { modLogChannelId: 'post', reportChannelId: 'post' });
  if (req.body.reportDailyLimit !== undefined) settings.reportDailyLimit = clampInt(req.body.reportDailyLimit, 1, 50, 5);
  if (req.body.reportChannelId !== undefined) settings.reportJoinAlert = req.body.reportJoinAlert === 'on';
  await settings.save();
  res.redirect(missing.length ? noPerm(req.params.guildId, 'moderation-settings', missing) : saved(req.params.guildId, 'moderation-settings'));
});
router.post('/:guildId/moderation/rules', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modDmEnabled = req.body.modDmEnabled === 'on';
  settings.modRequireReason = req.body.modRequireReason === 'on';
  settings.modEscalateNeedsPerm = req.body.modEscalateNeedsPerm === 'on';
  settings.modWarnExpireDays = clampInt(req.body.modWarnExpireDays, 0, 365, settings.modWarnExpireDays);
  saveThresholds(settings, req.body);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation-auto'));
});

module.exports = router;
module.exports.botReadiness = botReadiness;
