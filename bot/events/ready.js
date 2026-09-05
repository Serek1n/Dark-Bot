const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info(`Bot logged in as ${client.user.tag} (${client.guilds.cache.size} серверов)`);
    client.user.setActivity('/help | Dark', { type: ActivityType.Watching });
  }
};
