const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, getUsers } = require('../../discordApi');
const { ModLog } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Moderation: channels, warning rules (escalation), cases ----
router.get('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  const actions = ['warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'automod', 'note'];
  const action = actions.includes(req.query.action) ? req.query.action : '';
  const where = action ? { guildId: req.params.guildId, action } : { guildId: req.params.guildId };
  const logs = await ModLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 50 });
  const users = await getUsers(logs.flatMap((l) => [l.userId, l.moderatorId]));
  const { parseThresholds } = require('../../../bot/modules/moderation');
  const { formatDuration } = require('../../../bot/utils/duration');
  res.render('dashboard/moderation', { guild, settings, channels, logs, users, action, thresholds: parseThresholds(settings.modWarnThresholds), formatDuration, active: 'moderation' });
});

router.post('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modLogChannelId = snowflake(req.body.modLogChannelId);
  settings.reportChannelId = snowflake(req.body.reportChannelId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation'));
});

// Rules of /mod: DMs, mandatory reason, warning expiry and "N warnings -> action" (kept apart from the channels form).
router.post('/:guildId/moderation/rules', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modDmEnabled = req.body.modDmEnabled === 'on';
  settings.modRequireReason = req.body.modRequireReason === 'on';
  settings.modEscalateNeedsPerm = req.body.modEscalateNeedsPerm === 'on';
  settings.modWarnExpireDays = clampInt(req.body.modWarnExpireDays, 0, 365, settings.modWarnExpireDays);
  const list = (v) => [].concat(v ?? []);
  const counts = list(req.body.thrCount), acts = list(req.body.thrAction), mins = list(req.body.thrMinutes);
  const { parseThresholds, ESCALATION_ACTIONS } = require('../../../bot/modules/moderation');
  const rows = counts.map((c, i) => ({
    count: clampInt(c, 0, 100, 0),
    action: ESCALATION_ACTIONS.includes(acts[i]) ? acts[i] : 'mute',
    minutes: clampInt(mins[i], 0, 40320 * 52, 0)
  }));
  // One rule per number of warnings (the last one wins); mutes are limited by Discord to 28 days.
  const byCount = new Map(rows.filter((r) => r.count >= 1).map((r) => [r.count, { ...r, minutes: r.action === 'mute' ? Math.min(Math.max(r.minutes, 1), 40320) : r.action === 'kick' ? 0 : r.minutes }]));
  settings.modWarnThresholds = JSON.stringify(parseThresholds(JSON.stringify([...byCount.values()])));
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation'));
});

module.exports = router;
