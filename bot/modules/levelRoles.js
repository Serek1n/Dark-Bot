const { LevelRole } = require('../../db');
const logger = require('../utils/logger');

/**
 * Pure helper, shared with the web panel.
 * levelRoles: [{ level, roleId }], current: array of role IDs the member already has.
 * Default: the member keeps every role up to their level. With `replace`, only the highest one.
 */
function computeRoleChanges(levelRoles, level, current, replace) {
  const reached = levelRoles.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const wanted = replace ? reached.slice(-1) : reached;
  const wantedIds = new Set(wanted.map((r) => r.roleId));
  const have = new Set(current);
  const add = [...wantedIds].filter((id) => !have.has(id));
  const remove = replace ? levelRoles.map((r) => r.roleId).filter((id) => have.has(id) && !wantedIds.has(id)) : [];
  return { add, remove };
}

// Level roles are read for every XP message, so keep them in memory for a short while.
const cache = new Map();
const TTL_MS = 60 * 1000;
async function getLevelRoles(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  const rows = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId }));
  cache.set(guildId, { rows, expires: Date.now() + TTL_MS });
  return rows;
}

/** Gives (and, in "replace" mode, takes away) level roles of a guild member. Never throws. */
async function applyLevelRoles(member, level, replace) {
  try {
    if (!member?.guild || member.user?.bot) return;
    const levelRoles = await getLevelRoles(member.guild.id);
    if (!levelRoles.length) return;
    const { add, remove } = computeRoleChanges(levelRoles, level, [...member.roles.cache.keys()], Boolean(replace));
    const usable = (id) => {
      const role = member.guild.roles.cache.get(id);
      return role && !role.managed && role.editable;
    };
    const toAdd = add.filter(usable);
    const toRemove = remove.filter(usable);
    if (toAdd.length) await member.roles.add(toAdd, 'Роль за уровень');
    if (toRemove.length) await member.roles.remove(toRemove, 'Роль за уровень');
    if (add.length !== toAdd.length) logger.warn(`Level roles: no permission for some roles in guild ${member.guild.id} (move the bot's role higher)`);
  } catch (err) {
    logger.error('applyLevelRoles failed:', err);
  }
}

module.exports = { computeRoleChanges, applyLevelRoles, getLevelRoles };
