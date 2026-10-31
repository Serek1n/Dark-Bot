// Roles the bot hands out on its own, without a moderator (reaction roles, interactive messages, the shop, voice roles,
// level roles, the autorole). Checked at the moment of giving, not only when the panel saved the setting: a role can get
// new permissions later, and then "click a button — become an admin" must not work.
const { PermissionFlagsBits: P } = require('discord.js');

// Never given by self-service, whoever set it up: these open the server's management or punishments.
const CRITICAL = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.ManageWebhooks | P.BanMembers | P.KickMembers;
// Also refused in the panel for people who are not administrators.
const DANGEROUS = CRITICAL | P.ModerateMembers | P.ManageMessages | P.MentionEveryone;

const bits = (role) => { try { return BigInt(role?.permissions?.bitfield ?? role?.permissions ?? 0); } catch { return 0n; } };
const isCritical = (role) => (bits(role) & CRITICAL) !== 0n;

/** Why the bot must not give this role by itself (text), or null when it may. Removing such a role is always allowed. */
function selfGiveRefusal(role, guild) {
  if (!role || (guild && role.id === guild.id)) return 'роль не найдена';
  if (role.managed) return 'управляется интеграцией';
  if (role.editable === false) return 'выше роли бота';
  if (isCritical(role)) return 'даёт права управления сервером';
  return null;
}
const canSelfGive = (role, guild) => selfGiveRefusal(role, guild) === null;

module.exports = { CRITICAL, DANGEROUS, isCritical, selfGiveRefusal, canSelfGive };
