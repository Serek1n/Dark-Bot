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

module.exports = { memberHasPermission, isModerator, isAdmin };
