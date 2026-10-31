// Roles for reactions (Lacuna's "интерактивные реакции"): one reaction can give several roles, and a link has a mode:
//   normal  — reaction gives the roles, removing it takes them away
//   single  — like normal, but only one link of the message at a time: taking a new one removes the others' roles (and reaction)
//   reverse — the reaction TAKES the roles away, removing it gives them back (e.g. "unsubscribe from news")
const { ReactionRole } = require('../../db');
const logger = require('../utils/logger');
const { canSelfGive } = require('../utils/safeRole');

// Which messages have reaction roles at all: a reaction anywhere else costs no database query.
let linked = null; // Set of message ids, loaded on first use
let loading = null;
const resetLinked = () => { linked = null; loading = null; };
['afterCreate', 'afterUpdate', 'afterUpsert', 'afterDestroy', 'afterBulkCreate', 'afterBulkDestroy', 'afterBulkUpdate'].forEach((h) => ReactionRole.addHook(h, resetLinked));
async function hasLinks(messageId) {
  if (!linked) {
    loading = loading || ReactionRole.findAll({ attributes: ['messageId'], raw: true }).then((rows) => new Set(rows.map((r) => r.messageId)));
    const set = await loading;
    if (!linked) linked = set;
  }
  return linked.has(messageId);
}

const MODES = ['normal', 'single', 'reverse'];
const emojiKey = (emoji) => (emoji.id ? emoji.id : emoji.name);
const rolesOf = (rr) => {
  let extra = [];
  try { extra = JSON.parse(rr.extraRoleIds || '[]'); } catch { extra = []; }
  return [rr.roleId, ...(Array.isArray(extra) ? extra : [])].filter((id) => typeof id === 'string' && id.length > 0).slice(0, 5);
};

async function apply(member, ids, give, guild = member.guild) {
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (!role || role.managed || role.editable === false) continue;
    if (give && !canSelfGive(role, guild)) { logger.warn(`reaction-role: ${role.name} has management rights, not given`); continue; }
    const has = member.roles.cache ? member.roles.cache.has(id) : null; // unknown (partial member): just try
    if (give && has !== true) await member.roles.add(role, 'Роль за реакцию').catch((err) => logger.warn('reaction-role add failed:', err.message));
    if (!give && has !== false) await member.roles.remove(role, 'Роль за реакцию').catch((err) => logger.warn('reaction-role remove failed:', err.message));
  }
}

/** Takes a person's reaction off a message (the bot keeps no reaction cache, so straight through the API). */
async function removeReaction(message, emoji, userId) {
  const rest = message.client?.rest;
  if (!rest) return;
  const id = /^\d{15,25}$/.test(emoji) ? `x:${emoji}` : encodeURIComponent(emoji); // custom emoji by id (the name is not checked)
  await rest.delete(`/channels/${message.channelId}/messages/${message.id}/reactions/${id}/${userId}`).catch(() => {});
}

/** A reaction was added (added = true) or removed. */
async function handleReactionRole(reaction, user, added) {
  const message = reaction.message;
  if (!(await hasLinks(message.id))) return;
  const rr = await ReactionRole.findOne({ where: { messageId: message.id, emoji: emojiKey(reaction.emoji) } });
  if (!rr) return;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  const mode = MODES.includes(rr.mode) ? rr.mode : 'normal';
  const ids = rolesOf(rr);
  const g = message.guild;
  if (mode === 'reverse') return apply(member, ids, !added, g);
  await apply(member, ids, added, g);
  if (mode === 'single' && added) {
    // the other links of this message: their roles go, and the person's reactions there are taken off (best effort)
    const others = await ReactionRole.findAll({ where: { messageId: message.id } });
    for (const o of others) {
      if (o.id === rr.id) continue;
      await apply(member, rolesOf(o).filter((id) => !ids.includes(id)), false, g);
      await removeReaction(message, o.emoji, user.id);
    }
  }
}

module.exports = { MODES, rolesOf, handleReactionRole, emojiKey, hasLinks, resetLinked };
