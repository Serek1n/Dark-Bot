const { Events } = require('discord.js');
const { markLeft, restore } = require('../modules/guildBackup');
const logger = require('../utils/logger');
const L = require('../modules/serverLog');

module.exports = [
  {
    name: Events.GuildDelete,
    async execute(guild) {
      if (guild.available === false) return; // a Discord outage, the bot is still on the server
      try {
        await markLeft(guild.id);
        L.invalidate(guild.id);
        logger.info(`Removed from server ${guild.id}: its data is kept for 14 days.`);
      } catch (err) {
        logger.error('Guild delete error:', err);
      }
    }
  },
  {
    name: Events.GuildCreate,
    async execute(guild) {
      try {
        if (await restore(guild.id)) {
          L.invalidate(guild.id);
          logger.info(`Back on server ${guild.id}: saved data restored.`);
        }
      } catch (err) {
        logger.error('Guild create error:', err);
      }
    }
  }
];
