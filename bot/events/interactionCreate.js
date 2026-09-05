const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        logger.error(`Command "${interaction.commandName}" failed:`, err);
        const payload = { embeds: [embeds.error('Произошла ошибка при выполнении команды.')], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.error('Autocomplete error:', err);
        }
      }
    }
  }
};
