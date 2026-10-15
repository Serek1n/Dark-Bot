// The invite link of the bot. One list of permissions for the panel and the README, so the bot is added
// with exactly what it needs instead of full Administrator rights.
const { PermissionFlagsBits: F, PermissionsBitField } = require('discord.js');

const PERMISSIONS = [
  F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory, F.AddReactions, // messages, cards (images), reactions
  F.ManageMessages, // /mod clear, automod
  F.ManageRoles, // level roles, autorole, reaction roles, shop roles
  F.ManageChannels, // temporary voice rooms, log forum tags
  F.ManageWebhooks, // log forum webhook
  F.KickMembers, F.BanMembers, F.ModerateMembers, // /mod
  F.ViewAuditLog, // who made a change, in the log forum
  F.Connect, F.Speak, F.MoveMembers // music and temporary voice rooms
];

const permissionsValue = () => new PermissionsBitField(PERMISSIONS).bitfield.toString();

/** Link that adds the bot; with guildId the server is preselected. */
function inviteUrl(clientId, guildId) {
  const params = new URLSearchParams({ client_id: clientId || '', scope: 'bot applications.commands', permissions: permissionsValue() });
  if (guildId) params.set('guild_id', guildId);
  return `https://discord.com/oauth2/authorize?${params.toString().replaceAll('+', '%20')}`;
}

module.exports = { PERMISSIONS, permissionsValue, inviteUrl };
