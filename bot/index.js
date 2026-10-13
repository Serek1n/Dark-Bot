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
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
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

async function main() {
  await init();
  logger.info('Database ready.');

  for (const [name, command] of loadCommands()) {
    client.commands.set(name, command);
  }
  logger.info(`Loaded ${client.commands.size} commands.`);

  loadEvents(client);
  logger.info('Events registered.');

  await client.login(process.env.DISCORD_TOKEN);

  startAlertPoller(client);
}

main().catch((err) => {
  logger.error('Fatal error starting bot:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));
