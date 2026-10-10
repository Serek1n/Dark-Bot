const { PermissionsBitField } = require('discord.js');

function memberHasPermission(member, flag) {
  return member.permissions.has(PermissionsBitField.Flags[flag]);
}

function isModerator(member) {
  return (
    memberHasPermission(member, 'ModerateMembers') ||
    memberHasPermission(member, 'KickMembers') ||
    memberHasPermission(member, 'BanMembers') ||
    memberHasPermission(member, 'Administrator')
  );
}

function isAdmin(member) {
  return memberHasPermission(member, 'Administrator') || memberHasPermission(member, 'ManageGuild');
}

/**
 * Can `actor` (GuildMember) moderate `target` (GuildMember)? Mirrors Discord's own role hierarchy:
 * nobody can act on the owner or on someone whose top role is equal/higher, unless actor is the owner.
 * Returns an error string, or null when the action is allowed.
 */
function hierarchyError(actor, target) {
  if (!target) return null;
  if (target.id === actor.id) return 'Нельзя применить это к самому себе.';
  if (target.user?.bot && target.id === target.client?.user?.id) return 'Нельзя применить это к боту.';
  const guild = actor.guild;
  if (!guild) return null;
  if (target.id === guild.ownerId) return 'Нельзя применить это к владельцу сервера.';
  if (actor.id === guild.ownerId) return null;
  if (target.roles?.highest && actor.roles?.highest && target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) {
    return 'Роль этого участника не ниже вашей — действие недоступно.';
  }
  return null;
}

module.exports = { memberHasPermission, isModerator, isAdmin, hierarchyError };
