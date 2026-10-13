const { MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { isMusicButton, handleMusicButton } = require('../modules/music/panel');
const { isTopButton, handleTopButton } = require('../modules/leaderboardPage');
const { isShopComponent, handleShopComponent } = require('../modules/shop');
const { featureForCommand, isEnabled } = require('../utils/features');
const { getOrCreateSettings } = require('../modules/leveling');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        // Features an admin switched off in the panel answer with a short note instead of running.
        const feature = interaction.guildId ? featureForCommand(interaction.commandName) : null;
        if (feature && !isEnabled(await getOrCreateSettings(interaction.guildId), feature.key)) {
          return await interaction.reply({ embeds: [embeds.info(`Функция «${feature.title}» отключена администрацией сервера.`)], flags: MessageFlags.Ephemeral });
        }
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

    if (isTopButton(interaction)) {
      try {
        await handleTopButton(interaction);
      } catch (err) {
        logger.error('Leaderboard button failed:', err);
      }
      return;
    }

    if (isShopComponent(interaction)) {
      try {
        await handleShopComponent(interaction);
      } catch (err) {
        logger.error('Shop interaction failed:', err);
        const payload = { embeds: [embeds.error('Не получилось выполнить действие.')], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
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
