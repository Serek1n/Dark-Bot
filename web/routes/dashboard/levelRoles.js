const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildRoles, getGuild, botApi } = require('../../discordApi');
const { MemberProfile, LevelRole } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');

const router = express.Router();

// ---- Level roles ----
const syncStatus = new Map(); // guildId -> { running, done, total, error }

router.get('/:guildId/level-roles', ensureGuildAccess, async (req, res) => {
  const [guild, settings, allRoles, guard] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildRoles(req.params.guildId), roleGuard(req.params.guildId, req.user?.id)]);
  const roles = guard.annotate(allRoles);
  const levelRoles = await LevelRole.findAll({ where: { guildId: req.params.guildId, track: 'total' }, order: [['level', 'ASC']] });
  res.render('dashboard/level-roles', { guild, settings, roles, levelRoles, sync: syncStatus.get(req.params.guildId) || null, active: 'level-roles' });
});

router.post('/:guildId/level-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const level = clampInt(req.body.level, 1, 500, 0);
  const roleId = snowflake(req.body.roleId);
  const roles = await getGuildRoles(guildId);
  if (!level || !roleId || !roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'level-roles', 'invalid'));
  if ((await roleGuard(guildId, req.user?.id)).check(roleId)) return res.redirect(saved(guildId, 'level-roles', 'rolenotallowed'));
  const track = 'total';
  // One role per (direction, level): saving the same pair again replaces the role.
  const existing = await LevelRole.findOne({ where: { guildId, level, track } });
  if (existing) await existing.update({ roleId });
  else await LevelRole.create({ guildId, level, roleId, track });
  res.redirect(saved(guildId, 'level-roles'));
});

router.post('/:guildId/level-roles/mode', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelRolesReplace = req.body.levelRolesReplace === 'on';
  await settings.save();
  res.redirect(saved(req.params.guildId, 'level-roles'));
});

router.post('/:guildId/level-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await LevelRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'level-roles', 'deleted'));
});

// Gives roles to everyone who already has the level (e.g. after importing levels). Runs in the background.
router.post('/:guildId/level-roles/sync', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  if (syncStatus.get(guildId)?.running) return res.redirect(saved(guildId, 'level-roles', 'running'));
  const settings = await getSettings(guildId);
  const status = { running: true, done: 0, total: 0, error: null };
  syncStatus.set(guildId, status);
  res.redirect(saved(guildId, 'level-roles', 'started'));

  (async () => {
    const { computeTrackRoleChanges } = require('../../../bot/modules/levelRoles');
    const levelRoles = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId, track: r.track }));
    if (!levelRoles.length) return;
    const profiles = await MemberProfile.findAll({ where: { guildId } });
    const levels = new Map(profiles.map((p) => [p.userId, { total: p.level }]));

    // All server members with their roles (paged by 1000).
    const members = [];
    let after = '0';
    for (;;) {
      const { data } = await botApi.get(`/guilds/${guildId}/members`, { params: { limit: 1000, after } });
      members.push(...data);
      if (data.length < 1000) break;
      after = data[data.length - 1].user.id;
    }
    const targets = members.filter((m) => levels.has(m.user.id) && !m.user.bot);
    status.total = targets.length;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const m of targets) {
      const { add, remove } = computeTrackRoleChanges(levelRoles, levels.get(m.user.id), m.roles, settings.levelRolesReplace);
      try {
        for (const id of add) { await botApi.put(`/guilds/${guildId}/members/${m.user.id}/roles/${id}`, null, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Роль за уровень') } }); await pause(300); }
        for (const id of remove) { await botApi.delete(`/guilds/${guildId}/members/${m.user.id}/roles/${id}`); await pause(300); }
      } catch (err) {
        status.failed = (status.failed || 0) + 1; // e.g. role is above the bot's role
      }
      status.done++;
    }
  })()
    .catch((err) => {
      // Shown on the page: Russian words, the raw error goes to the log only.
      require('../../../bot/utils/logger').warn(`Level role sync failed on ${guildId}: ${err.message}`);
      status.error = err.response?.status === 403 ? 'Discord не отдал список участников: включите боту «Server Members Intent» на портале разработчика и проверьте его права.' : require('../../../bot/utils/discordErrors').errorText(err);
    })
    .finally(() => { status.running = false; });
});

module.exports = router;
