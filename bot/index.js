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

  // The web panel runs in this same process (instant settings, shared cache); WEB_ENABLED=false keeps it off.
  if (String(process.env.WEB_ENABLED || 'true').toLowerCase() !== 'false') {
    // Whatever goes wrong with the panel (bad OAuth settings, busy port) must never take the bot down with it.
    try {
      await require('../web').start({ client });
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
