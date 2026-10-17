const { GuildSettings } = require('../../db');
const { fillTemplate } = require('./guildMemberAdd');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    if (!member?.guild || member.user?.bot) return;
    const settings = await GuildSettings.findOne({ where: { guildId: member.guild.id } });
    if (!settings || !settings.welcomeEnabled || !settings.leaveChannelId) return;
    const channel = await member.guild.channels.fetch(settings.leaveChannelId).catch(() => null);
    if (!channel) return;
    // Nobody to ping: the member is already gone, so the name goes in as plain text.
    const name = member.displayName || member.user?.username || 'участник';
    const text = fillTemplate(settings.leaveMessage, { id: member.id, displayName: name, user: member.user, guild: member.guild }, false);
    channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }
};
