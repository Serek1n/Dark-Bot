const { ActivityType, Events } = require('discord.js');
const logger = require('../utils/logger');
const { seedFromGuilds } = require('../modules/voiceTime');
const { startGuildBackup } = require('../modules/guildBackup');
const { startModScheduler } = require('../modules/moderation');
const { startGiveawayScheduler } = require('../modules/giveaways');
const { startReminderScheduler } = require('../modules/reminders');
const { startPollScheduler } = require('../modules/polls');
const { startRestoreCleanup } = require('../modules/memberRestore');

// data/status.json: proof that this exact process started and logged in. scripts/update.sh waits for it after a restart
// and rolls back to the previous version if it never appears.
function writeStatus(client) {
  try {
    const fs = require('fs'); const path = require('path');
    const v = require('../utils/version').versionInfo();
    const dir = path.join(__dirname, '..', '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ pid: process.pid, readyAt: Date.now(), tag: client.user?.tag, guilds: client.guilds.cache.size, bot: v.bot, panel: v.panel, channel: v.channel, branch: v.branch, commit: v.commit }, null, 2));
  } catch (err) {
    logger.warn(`status.json not written: ${err.message}`);
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot logged in as ${client.user.tag} (${client.guilds.cache.size} серверов)`);
    writeStatus(client);
    seedFromGuilds(client);
    startGuildBackup(client);
    startModScheduler(client); // lifts temporary bans when their time is up
    startGiveawayScheduler(client); // ends giveaways when their time is up
    startReminderScheduler(client); // sends due reminders
    startPollScheduler(client); // posts the results of timed polls
    require('../modules/scheduledMessages').startScheduledMessages(); // messages from the panel on a schedule
    // Profiles of bots (the bot itself included) made before /profile, /economy pay and the panel checked for them: out of the top.
    (async () => {
      const botIds = new Set([client.user.id]);
      for (const g of client.guilds.cache.values()) for (const m of g.members.cache.values()) if (m.user?.bot) botIds.add(m.id);
      const removed = await require('../../db').MemberProfile.destroy({ where: { userId: [...botIds] } });
      if (removed) logger.info(`Removed ${removed} profile(s) of bots from leaderboards`);
    })().catch((err) => logger.warn(`Bot profiles cleanup failed: ${err.message}`));
    require('../modules/tempRoles').startTempRoleScheduler(client); // takes temporary roles away when their time is up
    startRestoreCleanup(); // forgets old data of members who left
    require('../modules/tickets').sweepClosedTickets(client).catch(() => {}); // closed tickets whose channel outlived a restart
    require('../modules/voiceRoles').sweepVoiceRoles(client).catch(() => {}); // voice roles of people who left while the bot was off
    require('../modules/updates').announceUpdates(client).catch(() => {}); // "what's new" into the chosen channels after an update
    client.user.setActivity('/help | Dark', { type: ActivityType.Watching });
  }
};
