// Voice roles: a role is given while the member is in a voice channel (a chosen one, or any) and taken when they leave.
// Handy for a #voice-chat text channel only visible to people in voice. The AFK channel never counts.
const { VoiceRole } = require('../../db');
const { getOrCreateSettings } = require('./leveling');
const { isEnabled } = require('../utils/features');
const logger = require('../utils/logger');
const { canSelfGive } = require('../utils/safeRole');

const cache = new Map(); // guildId -> { rows, at }
const TTL = 60_000;
['afterCreate', 'afterUpdate', 'afterDestroy', 'afterBulkCreate', 'afterBulkDestroy'].forEach((h) => VoiceRole.addHook(h, () => cache.clear()));

async function rulesFor(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const rows = (await VoiceRole.findAll({ where: { guildId }, raw: true })).map((r) => ({ roleId: r.roleId, channelId: r.channelId || null }));
  cache.set(guildId, { rows, at: Date.now() });
  return rows;
}

/** Roles of these rules the member should have while in `channelId` (null = not in voice). Pure. */
function wantedRoles(rules, channelId, afkId) {
  if (!channelId || channelId === afkId) return new Set();
  return new Set(rules.filter((r) => !r.channelId || r.channelId === channelId).map((r) => r.roleId));
}

async function syncMember(member, channelId) {
  const guild = member.guild;
  const rules = await rulesFor(guild.id);
  if (!rules.length || member.user?.bot) return;
  if (!isEnabled(await getOrCreateSettings(guild.id), 'voiceRoles')) return;
  const wanted = wantedRoles(rules, channelId, guild.afkChannelId);
  for (const roleId of new Set(rules.map((r) => r.roleId))) {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.managed || role.editable === false) continue;
    const has = member.roles.cache.has(roleId);
    if (wanted.has(roleId) && !has && canSelfGive(role, guild)) await member.roles.add(role, 'Голосовая роль: зашёл в голосовой канал').catch((e) => logger.warn(`voice role add: ${e.message}`));
    if (!wanted.has(roleId) && has) await member.roles.remove(role, 'Голосовая роль: вышел из голосового канала').catch((e) => logger.warn(`voice role remove: ${e.message}`));
  }
}

/** After a restart: whoever left voice while the bot was offline loses the role, whoever sits in voice gets it. */
async function sweepVoiceRoles(client) {
  for (const guild of client.guilds.cache.values()) {
    const rules = await rulesFor(guild.id).catch(() => []);
    if (!rules.length) continue;
    const holders = new Set();
    for (const r of rules) for (const m of guild.roles.cache.get(r.roleId)?.members?.values?.() || []) holders.add(m);
    for (const s of guild.voiceStates.cache.values()) if (s.member) holders.add(s.member);
    for (const m of holders) await syncMember(m, m.voice?.channelId || null).catch(() => {});
  }
}

module.exports = { syncMember, sweepVoiceRoles, wantedRoles, rulesFor };
