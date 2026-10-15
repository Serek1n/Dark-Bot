const { ActivityType, Events } = require('discord.js');
const logger = require('../utils/logger');
const { seedFromGuilds } = require('../modules/voiceTime');
const { startGuildBackup } = require('../modules/guildBackup');
const { startModScheduler } = require('../modules/moderation');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot logged in as ${client.user.tag} (${client.guilds.cache.size} серверов)`);
    seedFromGuilds(client);
    startGuildBackup(client);
    startModScheduler(client); // lifts temporary bans when their time is up
    client.user.setActivity('/help | Dark', { type: ActivityType.Watching });
  }
};
