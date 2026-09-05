require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const logger = require('./utils/logger');

async function main() {
  const commands = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  const route = process.env.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

  logger.info(`Registering ${commands.length} slash commands ${process.env.DEV_GUILD_ID ? '(guild-scoped, instant)' : '(global, may take up to 1h to propagate)'}...`);
  await rest.put(route, { body: commands });
  logger.info('Done.');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
