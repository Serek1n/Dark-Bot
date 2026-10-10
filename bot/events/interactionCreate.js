const { MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { isMusicButton, handleMusicButton } = require('../modules/music/panel');

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
        const payload = { embeds: [embeds.error('Произошла ошибка при выполнении команды.')], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (isMusicButton(interaction)) {
      try {
        await handleMusicButton(interaction);
      } catch (err) {
        logger.error('Music button failed:', err);
        const payload = { embeds: [embeds.error('Не получилось выполнить действие.')], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
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
