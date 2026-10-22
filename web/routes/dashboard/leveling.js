const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, getUsers, botApi } = require('../../discordApi');
const { MemberProfile, LevelRole } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Leveling settings ----
router.get('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  // Result of the last manual level change (the redirect carries it in the query string).
  let adjusted = null;
  const q = req.query;
  if (q.adjusted && snowflake(q.u)) {
    const users = await getUsers([q.u]);
    adjusted = { name: users[q.u]?.name || q.u, from: clampInt(q.from, 0, 1000, 0), to: clampInt(q.to, 0, 1000, 0), roles: ['ok', 'fail', 'none'].includes(q.roles) ? q.roles : 'none' };
  }
  res.render('dashboard/leveling', { guild, settings, channels, adjusted, prefillUser: snowflake(q.user) || '', active: 'leveling' });
});

// Manual level change: add, take away or set an exact level. Roles for levels are updated right away.
router.post('/:guildId/leveling/adjust', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'leveling', 'baduser'));
  const mode = ['add', 'remove', 'set'].includes(req.body.mode) ? req.body.mode : 'add';
  const { computeLevelAdjust, MAX_LEVEL } = require('../../../bot/modules/leveling');
  const amount = clampInt(req.body.amount, mode === 'set' ? 0 : 1, MAX_LEVEL, mode === 'set' ? 0 : 1);

  await MemberProfile.findOrCreate({ where: { guildId, userId } });
  // The bot adds experience at the same time: write only if nobody changed the row since it was read, otherwise read again.
  let result = null;
  for (let attempt = 0; attempt < 5 && !result; attempt++) {
    const profile = await MemberProfile.findOne({ where: { guildId, userId } });
    const next = computeLevelAdjust(profile, mode, amount);
    const [changed] = await MemberProfile.update(
      { xp: next.xp, level: next.level, chatXp: next.chatXp, voiceXp: next.voiceXp },
      { where: { guildId, userId, xp: profile.xp, chatXp: profile.chatXp, voiceXp: profile.voiceXp } }
    );
    if (changed) result = next;
  }
  if (!result) return res.redirect(saved(guildId, 'leveling', 'invalid'));

  // Level roles (best effort: the member may have left, or the bot may not be allowed to give a role).
  let roles = 'none';
  try {
    const settings = await getSettings(guildId);
    const levelRoles = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId, track: r.track }));
    if (levelRoles.length) {
      const { computeAdjustRoleChanges } = require('../../../bot/modules/levelRoles');
      const member = await botApi.get(`/guilds/${guildId}/members/${userId}`).then((r) => r.data).catch(() => null);
      if (member && !member.user?.bot) {
        const { add, remove } = computeAdjustRoleChanges(levelRoles, result.level, member.roles || [], settings.levelRolesReplace, result.level < result.previousLevel);
        const reason = { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Уровень изменён администратором') } };
        let failed = false;
        for (const id of add) await botApi.put(`/guilds/${guildId}/members/${userId}/roles/${id}`, null, reason).catch(() => { failed = true; });
        for (const id of remove) await botApi.delete(`/guilds/${guildId}/members/${userId}/roles/${id}`, reason).catch(() => { failed = true; });
        roles = failed ? 'fail' : 'ok';
      }
    }
  } catch (err) {
    roles = 'fail';
  }
  res.redirect(`/dashboard/${guildId}/leveling?adjusted=1&u=${userId}&from=${result.previousLevel}&to=${result.level}&roles=${roles}#adjust`);
});

router.post('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelingEnabled = req.body.levelingEnabled === 'on';
  // Chat direction
  settings.chatEnabled = req.body.chatEnabled === 'on';
  const min = clampInt(req.body.xpPerMessageMin, 1, 1000, settings.xpPerMessageMin);
  const max = clampInt(req.body.xpPerMessageMax, 1, 1000, settings.xpPerMessageMax);
  settings.xpPerMessageMin = Math.min(min, max);
  settings.xpPerMessageMax = Math.max(min, max);
  settings.xpCooldownSeconds = clampInt(req.body.xpCooldownSeconds, 0, 3600, settings.xpCooldownSeconds);
  settings.chatCoinsPerMessage = clampInt(req.body.chatCoinsPerMessage, 0, 10000, settings.chatCoinsPerMessage);
  // Voice direction
  settings.voiceEnabled = req.body.voiceEnabled === 'on';
  settings.voiceXpPerMinute = clampInt(req.body.voiceXpPerMinute, 0, 500, settings.voiceXpPerMinute);
  settings.voiceCoinsPerMinute = clampInt(req.body.voiceCoinsPerMinute, 0, 10000, settings.voiceCoinsPerMinute);
  settings.voiceSkipMuted = req.body.voiceSkipMuted === 'on';
  settings.voiceMinMembers = clampInt(req.body.voiceMinMembers, 1, 10, settings.voiceMinMembers);
  settings.crystalsPerLevel = clampInt(req.body.crystalsPerLevel, 0, 10000, settings.crystalsPerLevel);
  settings.levelUpChannelId = snowflake(req.body.levelUpChannelId);
  settings.levelUpInVoice = req.body.levelUpInVoice === 'on';
  await settings.save();
  res.redirect(saved(req.params.guildId, 'leveling'));
});

// ---- Leaderboard (read-only) ----
// Import levels from another bot's export (JSON is read in the browser and sent here).
router.post('/:guildId/leveling/import', ensureGuildAccess, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { importLacuna } = require('../../../bot/modules/importLevels');
    const result = await importLacuna(req.params.guildId, req.body && req.body.users);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Ошибка импорта' });
  }
});
// Body-parser problems (too large, bad JSON) answer in JSON too, so the page can show them.
router.use('/:guildId/leveling/import', (err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || 400).json({ ok: false, error: err.type === 'entity.too.large' ? 'Файл слишком большой' : 'Не удалось прочитать файл' });
});

// Export all members' levels (JSON in the same shape the import reads, or CSV for spreadsheets).
router.get('/:guildId/leveling/export', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { totalXpForLevel } = require('../../../bot/modules/leveling');
  const profiles = await MemberProfile.findAll({ where: { guildId }, order: [['xp', 'DESC']] });
  const rows = profiles.map((p) => ({
    userId: p.userId,
    level: p.level,
    xp: Number(p.xp),
    progress: Math.max(0, Number(p.xp) - totalXpForLevel(p.level)),
    messages: Number(p.messageCount),
    voiceSeconds: Number(p.voiceSeconds || 0),
    balance: Number(p.balance),
    chatXp: Number(p.chatXp || 0),
    voiceXp: Number(p.voiceXp || 0),
    crystals: Number(p.crystals || 0)
  }));

  if (req.query.format === 'csv') {
    const lines = ['user_id,level,xp,chat_xp,voice_xp,messages,voice_seconds,coins,crystals', ...rows.map((r) => [r.userId, r.level, r.xp, r.chatXp, r.voiceXp, r.messages, r.voiceSeconds, r.balance, r.crystals].join(','))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="levels-${guildId}.csv"` });
    return res.send('\ufeff' + lines.join('\n'));
  }

  const data = rows.map((r) => ({
    _id: r.userId,
    activities: {
      levels: [
        {
          guild_id: guildId,
          experience: { total: r.xp, current: r.progress, level: r.level },
          activity: { total_messages: r.messages, total_voice_time: r.voiceSeconds }
        }
      ],
      wallets: [{ guild_id: guildId, currencies: [{ id: 'DEFAULT', amount: r.balance }] }]
    },
    // Extra data of this bot: both level directions and the second currency.
    dark: { chatXp: r.chatXp, voiceXp: r.voiceXp, crystals: r.crystals }
  }));
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="levels-${guildId}.json"` });
  res.send(JSON.stringify(data, null, 2));
});

router.get('/:guildId/leaderboard', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const tracks = { total: ['xp', 'level'], voice: ['voiceSeconds', 'level'] };
  const track = tracks[req.query.track] ? req.query.track : 'total';
  const [xpField, levelField] = tracks[track];
  const where = track === 'total' ? { guildId: req.params.guildId } : { guildId: req.params.guildId, [xpField]: { [Op.gt]: 0 } };
  const top = await MemberProfile.findAll({ where, order: [[xpField, 'DESC']], limit: 50 });
  const users = await getUsers(top.map((p) => p.userId));
  res.render('dashboard/leaderboard', { guild, top, users, track, xpField, levelField, active: 'leaderboard' });
});

module.exports = router;
