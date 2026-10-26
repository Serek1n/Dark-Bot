// Which roles a panel user may hand out through the bot (reaction roles, level roles, shop, autorole).
// Without this, someone with only "Manage Server" could bind an admin role to a reaction and click it.
// A role is refused when: Discord manages it (bot/booster roles), it is not below the bot's top role,
// it is not below the user's own top role (the server owner and BOT_OWNER_IDS are exempt), or it carries
// moderation/admin permissions and the user is not an administrator.
const { PermissionFlagsBits: P } = require('discord.js');
const { getClient } = require('../botBridge');

const DANGEROUS = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.ManageWebhooks | P.BanMembers | P.KickMembers | P.ModerateMembers | P.ManageMessages | P.MentionEveryone;

const REASONS = {
  managed: 'управляется интеграцией',
  bot: 'выше роли бота',
  you: 'не ниже вашей высшей роли',
  danger: 'с правами модерации — только для администраторов'
};

/**
 * Returns { check(roleId) -> null | reason text, annotate(roles) -> roles with `blocked` }.
 * Without the bot in this process the rules are checked over REST (see restGuard).
 */
async function roleGuard(guildId, userId) {
  if (!userId) { const no = () => 'нет пользователя'; return { check: no, annotate: (roles) => roles.map((r) => ({ ...r, blocked: no() })) }; }
  const guild = getClient()?.guilds.cache.get(guildId);
  if (!guild) return restGuard(guildId, userId);
  const owners = (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isOwner = guild.ownerId === userId || owners.includes(userId);
  const member = isOwner ? null : await guild.members.fetch(userId).catch(() => null);
  const isAdmin = isOwner || Boolean(member?.permissions?.has(P.Administrator));
  const botTop = guild.members.me?.roles?.highest?.position ?? 0;
  const userTop = isOwner ? Infinity : (member?.roles?.highest?.position ?? 0);

  const check = (roleId) => {
    const role = guild.roles.cache.get(String(roleId));
    if (!role || role.id === guild.id) return 'роль не найдена';
    if (role.managed) return REASONS.managed;
    if (role.position >= botTop) return REASONS.bot;
    if (role.position >= userTop) return REASONS.you;
    if (!isAdmin && (BigInt(role.permissions?.bitfield ?? 0n) & DANGEROUS) !== 0n) return REASONS.danger;
    return null;
  };
  return { check, annotate: (roles) => roles.map((r) => ({ ...r, blocked: check(r.id) })) };
}

/**
 * The same rules when the bot is not in this process (the panel started on its own): roles and members are read over REST.
 * If Discord cannot be asked, every role is refused — a failed check must never let anything through.
 */
async function restGuard(guildId, userId) {
  const { botApi } = require('../discordApi');
  const get = (url) => botApi.get(url).then((r) => r.data);
  let guild, me, member;
  try {
    guild = await get(`/guilds/${guildId}`);
    me = await get(`/guilds/${guildId}/members/${process.env.DISCORD_CLIENT_ID}`);
    member = userId ? await get(`/guilds/${guildId}/members/${userId}`).catch(() => null) : null;
  } catch {
    const no = () => 'не удалось проверить права — попробуйте позже';
    return { check: no, annotate: (roles) => roles.map((r) => ({ ...r, blocked: no() })) };
  }
  const roles = new Map((guild.roles || []).map((r) => [r.id, r]));
  const top = (ids) => Math.max(0, ...(ids || []).map((id) => roles.get(id)?.position ?? 0));
  const owners = (process.env.BOT_OWNER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const isOwner = guild.owner_id === userId || owners.includes(userId);
  const perms = (ids) => (ids || []).reduce((acc, id) => acc | BigInt(roles.get(id)?.permissions || 0), BigInt(roles.get(guildId)?.permissions || 0));
  const isAdmin = isOwner || (member && (perms(member.roles) & P.Administrator) !== 0n);
  const botTop = top(me.roles);
  const userTop = isOwner ? Infinity : top(member?.roles);
  const check = (roleId) => {
    const role = roles.get(String(roleId));
    if (!role || role.id === guildId) return 'роль не найдена';
    if (role.managed) return REASONS.managed;
    if (role.position >= botTop) return REASONS.bot;
    if (role.position >= userTop) return REASONS.you;
    if (!isAdmin && (BigInt(role.permissions || 0) & DANGEROUS) !== 0n) return REASONS.danger;
    return null;
  };
  return { check, annotate: (list) => list.map((r) => ({ ...r, blocked: check(r.id) })) };
}

module.exports = { roleGuard, DANGEROUS };
