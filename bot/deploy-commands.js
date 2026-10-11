require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const logger = require('./utils/logger');

async function main() {
  const commands = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Commands are registered globally so every server where the bot is gets the same set.
  // Any guild-scoped copies (older setups registered via DEV_GUILD_ID) are cleared so
  // commands are not listed twice.
  logger.info(`Registering ${commands.length} slash commands globally...`);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });

  if (process.env.DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID), { body: [] });
    logger.info('Cleared guild-scoped duplicates for DEV_GUILD_ID.');
  }
  logger.info('Done. Discord may need a minute (and Ctrl+R in the client) to refresh the list.');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
