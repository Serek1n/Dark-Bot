const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, botApi } = require('../../discordApi');
const { ReactionRole } = require('../../../db');
const { snowflake, saved } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');

const router = express.Router();

// ---- Reaction roles ----
router.get('/:guildId/reaction-roles', ensureGuildAccess, async (req, res) => {
  const [guild, channels, allRoles, guard] = await Promise.all([getGuild(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId), roleGuard(req.params.guildId, req.user?.id)]);
  const roles = guard.annotate(allRoles);
  const reactionRoles = await ReactionRole.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/reaction-roles', { guild, channels, roles, reactionRoles, flag: req.query, active: 'reaction-roles' });
});

router.post('/:guildId/reaction-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const channelId = snowflake(req.body.channelId);
  const messageId = snowflake(req.body.messageId);
  const roleId = snowflake(req.body.roleId);
  const raw = (req.body.emoji || '').trim();
  const custom = raw.match(/^<a?:(\w+):(\d+)>$/);
  const emoji = custom ? custom[2] : raw;
  if (!channelId || !messageId || !roleId || !emoji || emoji.length > 64) {
    return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  }
  // The message must exist in that channel of this server, otherwise the link would never fire.
  const channels = await getGuildChannels(guildId);
  if (!channels.some((c) => c.id === channelId)) return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  const roles = await getGuildRoles(guildId);
  if (!roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  // up to 4 more roles for the same reaction, and the mode (normal | single | reverse)
  const extra = [...new Set([].concat(req.body.extraRoleId || []).map(snowflake).filter((id) => id && id !== roleId))].slice(0, 4);
  if (extra.some((id) => !roles.some((r) => r.id === id))) return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  const guard = await roleGuard(guildId, req.user?.id);
  if ([roleId, ...extra].some((id) => guard.check(id))) return res.redirect(saved(guildId, 'reaction-roles', 'rolenotallowed'));
  const mode = require('../../../bot/modules/reactionRoles').MODES.includes(req.body.mode) ? req.body.mode : 'normal';
  const found = await botApi.get(`/channels/${channelId}/messages/${messageId}`).then(() => true).catch(() => false);
  if (!found) return res.redirect(saved(guildId, 'reaction-roles', 'nomessage'));

  await ReactionRole.upsert({ guildId, channelId, messageId, emoji, roleId, extraRoleIds: extra.length ? JSON.stringify(extra) : null, mode });
  // Put the reaction under the message so people can click it (best effort).
  const reactionPath = custom ? `${custom[1]}:${custom[2]}` : encodeURIComponent(emoji);
  await botApi.put(`/channels/${channelId}/messages/${messageId}/reactions/${reactionPath}/@me`).catch(() => {});
  res.redirect(saved(guildId, 'reaction-roles'));
});

router.post('/:guildId/reaction-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await ReactionRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'reaction-roles', 'deleted'));
});

module.exports = router;
