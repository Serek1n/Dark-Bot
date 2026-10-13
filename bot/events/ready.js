const { ActivityType, Events } = require('discord.js');
const logger = require('../utils/logger');
const { seedFromGuilds } = require('../modules/voiceTime');
const { startShopTimers } = require('../modules/shop');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot logged in as ${client.user.tag} (${client.guilds.cache.size} серверов)`);
    seedFromGuilds(client);
    startShopTimers(client);
    client.user.setActivity('/help | Dark', { type: ActivityType.Watching });
  }
};
