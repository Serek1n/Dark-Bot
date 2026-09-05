const { GuildSettings } = require('../../db');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const settings = await GuildSettings.findOne({ where: { guildId: member.guild.id } });
    if (!settings) return;

    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role) member.roles.add(role).catch((err) => logger.warn('Failed to add autorole:', err.message));
    }

    if (settings.welcomeChannelId) {
      const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
      if (channel) {
        const text = settings.welcomeMessage
          .replace('{user}', `<@${member.id}>`)
          .replace('{server}', member.guild.name);
        channel.send(text).catch(() => {});
      }
    }
  }
};
