const { MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { isMusicButton, handleMusicButton } = require('../modules/music/panel');
const { isTopButton, handleTopButton } = require('../modules/leaderboardPage');
const { isShopComponent, handleShopComponent } = require('../modules/shop');
const { isGiveawayButton, handleGiveawayButton } = require('../modules/giveaways');
const { isTicketButton, handleTicketButton } = require('../modules/tickets');
const { isVoiceRoomComponent, handleVoiceRoomComponent } = require('../modules/voiceRoom');
const { isWebhookComponent, handleWebhookComponent } = require('../modules/webhookPanel');
const { featureForCommand, isEnabled, disabledText } = require('../utils/features');
const { getOrCreateSettings } = require('../modules/leveling');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      // Everything works on a server; a command opened in the bot's DMs gets a short note instead of an error.
      if (typeof interaction.inGuild === 'function' && !interaction.inGuild() && !command.dmAllowed) {
        return interaction.reply({ embeds: [embeds.info('Эта команда работает только на сервере.')], flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      try {
        // Features an admin switched off in the panel answer with a short note instead of running.
        const feature = interaction.guildId ? featureForCommand(interaction.commandName) : null;
        const featureSettings = feature ? await getOrCreateSettings(interaction.guildId) : null;
        if (feature && !isEnabled(featureSettings, feature.key)) {
          return await interaction.reply({ embeds: [embeds.info(disabledText(featureSettings, feature.key))], flags: MessageFlags.Ephemeral });
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

    for (const [matches, handle, label] of [[isGiveawayButton, handleGiveawayButton, 'Giveaway'], [isTicketButton, handleTicketButton, 'Ticket']]) {
      if (!matches(interaction)) continue;
      try {
        await handle(interaction);
      } catch (err) {
        logger.error(`${label} button failed:`, err);
        const payload = { embeds: [embeds.error('Не получилось выполнить действие.')], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
      return;
    }

    if (isVoiceRoomComponent(interaction)) {
      await handleVoiceRoomComponent(interaction); // answers its own errors
      return;
    }

    if (isWebhookComponent(interaction)) {
      await handleWebhookComponent(interaction); // answers its own errors
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
