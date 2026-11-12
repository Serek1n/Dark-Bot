const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildRoles, botApi } = require('../../discordApi');
const { MemberProfile, LevelRole } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');

const router = express.Router();
const back = (guildId, flag) => saved(guildId, 'leveling', flag) + '#level-roles';

// ---- Level roles ----
const syncStatus = new Map(); // guildId -> { running, done, total, error }

// Roles for levels are a part of the "Уровни" page now; the old address leads there.
router.get('/:guildId/level-roles', (req, res) => {
  const id = snowflake(req.params.guildId);
  res.redirect(301, id ? `/dashboard/${id}/leveling#level-roles` : '/dashboard');
});

/** What the "Роли за уровни" part of the "Уровни" page shows. */
async function levelRolesData(guildId, userId) {
  const [allRoles, guard, levelRoles] = await Promise.all([
    getGuildRoles(guildId), roleGuard(guildId, userId),
    LevelRole.findAll({ where: { guildId, track: 'total' }, order: [['level', 'ASC']] })
  ]);
  return { roles: guard.annotate(allRoles), levelRoles, sync: syncStatus.get(guildId) || null };
}

router.post('/:guildId/level-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const level = clampInt(req.body.level, 1, 500, 0);
  const roleId = snowflake(req.body.roleId);
  const roles = await getGuildRoles(guildId);
  if (!level || !roleId || !roles.some((r) => r.id === roleId)) return res.redirect(back(guildId, 'invalid'));
  if ((await roleGuard(guildId, req.user?.id)).check(roleId)) return res.redirect(back(guildId, 'rolenotallowed'));
  const track = 'total';
  // One role per (direction, level): saving the same pair again replaces the role.
  const existing = await LevelRole.findOne({ where: { guildId, level, track } });
  const keep = req.body.keep === 'on';
  if (existing) await existing.update({ roleId, keep });
  else await LevelRole.create({ guildId, level, roleId, track, keep });
  res.redirect(back(guildId));
});

// "Keep": the role stays even in "only the highest role" mode.
router.post('/:guildId/level-roles/keep/:id', ensureGuildAccess, async (req, res) => {
  await LevelRole.update({ keep: req.body.keep === 'on' }, { where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId: req.params.guildId } });
  res.redirect(back(req.params.guildId));
});

router.post('/:guildId/level-roles/mode', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelRolesReplace = req.body.levelRolesReplace === 'on';
  await settings.save();
  res.redirect(back(req.params.guildId));
});

router.post('/:guildId/level-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await LevelRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(back(req.params.guildId, 'deleted'));
});

// Gives roles to everyone who already has the level (e.g. after importing levels). Runs in the background.
router.post('/:guildId/level-roles/sync', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  if (syncStatus.get(guildId)?.running) return res.redirect(back(guildId, 'running'));
  const settings = await getSettings(guildId);
  const status = { running: true, done: 0, total: 0, error: null };
  syncStatus.set(guildId, status);
  res.redirect(back(guildId, 'started'));

  (async () => {
    const { computeTrackRoleChanges } = require('../../../bot/modules/levelRoles');
    const levelRoles = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId, track: r.track, keep: Boolean(r.keep) }));
    if (!levelRoles.length) return;
    const profiles = await MemberProfile.findAll({ where: { guildId }, attributes: ['userId', 'level'], raw: true });
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
    const critical = await require('../../utils/roles').criticalRoleIds(guildId); // never a role that gives control over the server
    for (const m of targets) {
      const { add, remove } = computeTrackRoleChanges(levelRoles, levels.get(m.user.id), m.roles, settings.levelRolesReplace);
      try {
        for (const id of add) { if (critical.has(id)) { status.failed = (status.failed || 0) + 1; continue; } await botApi.put(`/guilds/${guildId}/members/${m.user.id}/roles/${id}`, null, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Роль за уровень') } }); await pause(300); }
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
module.exports.levelRolesData = levelRolesData;
