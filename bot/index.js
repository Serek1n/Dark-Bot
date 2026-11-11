require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, Options } = require('discord.js');
const { init } = require('../db');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');
const { startAlertPoller } = require('./modules/alerts/poller');
const logger = require('./utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    // Only for the "Логи" forum (none of these is privileged): emoji, scheduled events, bans.
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
  // Default for every message: only user mentions ping. Text from outside (track titles, nicknames, feed titles) can't
  // ping @everyone or a role; the few messages that should ping a role say so themselves (tickets).
  allowedMentions: { parse: ['users'], repliedUser: true },
  // The bot never reads old messages, reactions or presences from the cache (events carry what they
  // need), so storing them only costs memory. Members and channels stay cached: voice XP needs them.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    PresenceManager: 0,
    ThreadManager: 0,
    StageInstanceManager: 0,
    GuildScheduledEventManager: 0
  })
});

client.commands = new Collection();
let webServer = null;

async function main() {
  await init();
  logger.info('Database ready.');

  for (const [name, command] of loadCommands()) {
    client.commands.set(name, command);
  }
  logger.info(`Loaded ${client.commands.size} commands.`);

  loadEvents(client);
  require('../i18n/discord').install(client); // servers set to English get everything in English
  logger.info('Events registered.');

  await client.login(process.env.DISCORD_TOKEN);

  startAlertPoller(client);

  // The web panel runs in this same process (instant settings, shared cache); WEB_ENABLED=false keeps it off.
  if (String(process.env.WEB_ENABLED || 'true').toLowerCase() !== 'false') {
    // Whatever goes wrong with the panel (bad OAuth settings, busy port) must never take the bot down with it.
    try {
      webServer = await require('../web').start({ client });
    } catch (err) {
      logger.error('Web panel failed to start (the bot keeps running):', err);
    }
  }
}

main().catch((err) => {
  logger.error('Fatal error starting bot:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));

// A clean stop (pm2 restart, an update, Ctrl+C): stop taking requests, write the voice time still held in memory, let the
// running database transaction finish, leave Discord and close the database. Without it every restart lost up to 5 minutes
// of everybody's voice time and could cut a purchase in half.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(`${signal}: stopping...`);
  const hardStop = setTimeout(() => process.exit(0), 8000); // never hang: pm2 kills after kill_timeout anyway
  hardStop.unref?.();
  try { if (webServer?.close) webServer.close(); } catch { /* not started */ }
  try { await require('./modules/voiceTime').flushAll(); } catch (err) { logger.warn(`voice time was not saved: ${err.message}`); }
  try { const db = require('../db'); await db.inTransaction(async () => {}); } catch { /* nothing was running */ }
  try { await client.destroy(); } catch { /* not logged in */ }
  try { await require('../db').sequelize.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
