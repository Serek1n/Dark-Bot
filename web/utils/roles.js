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
 * When the bot is not running in this process the check cannot be made and nothing is blocked.
 */
async function roleGuard(guildId, userId) {
  const guild = getClient()?.guilds.cache.get(guildId);
  if (!guild) return { check: () => null, annotate: (roles) => roles };
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

module.exports = { roleGuard, DANGEROUS };
