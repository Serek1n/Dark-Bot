const { ActivityType, Events } = require('discord.js');
const logger = require('../utils/logger');
const { seedFromGuilds } = require('../modules/voiceTime');
const { startGuildBackup } = require('../modules/guildBackup');
const { startModScheduler } = require('../modules/moderation');
const { startGiveawayScheduler } = require('../modules/giveaways');
const { startReminderScheduler } = require('../modules/reminders');
const { startPollScheduler } = require('../modules/polls');
const { startRestoreCleanup } = require('../modules/memberRestore');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot logged in as ${client.user.tag} (${client.guilds.cache.size} серверов)`);
    seedFromGuilds(client);
    startGuildBackup(client);
    startModScheduler(client); // lifts temporary bans when their time is up
    startGiveawayScheduler(client); // ends giveaways when their time is up
    startReminderScheduler(client); // sends due reminders
    startPollScheduler(client); // posts the results of timed polls
    startRestoreCleanup(); // forgets old data of members who left
    require('../modules/tickets').sweepClosedTickets(client).catch(() => {}); // closed tickets whose channel outlived a restart
    require('../modules/updates').announceUpdates(client).catch(() => {}); // "what's new" into the chosen channels after an update
    client.user.setActivity('/help | Dark', { type: ActivityType.Watching });
  }
};
