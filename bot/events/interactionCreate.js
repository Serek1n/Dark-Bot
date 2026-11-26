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
const mc = require('../utils/moduleConfig');
const { getOrCreateSettings } = require('../modules/leveling');

// Discord refused for lack of rights: name the missing ones; anything else: the usual short text.
function failureText(interaction, err, fallback) {
  return require('../utils/missingPermissions').explainMissing(err, interaction.guild, interaction.channel) || fallback;
}

const tellFailed = async (interaction) => { // the person sees why nothing happened instead of Discord's bare "interaction failed"
  const payload = { embeds: [embeds.error('Не получилось выполнить действие. Попробуйте ещё раз.')], flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
};

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // too many presses from one person: told once, the rest ignored (autocomplete is typing, it is not counted)
    if (!interaction.isAutocomplete?.()) {
      const verdict = require('../utils/interactionGuard').check(interaction.user?.id || 'unknown');
      if (verdict === 'tell') return interaction.reply({ embeds: [embeds.info('Слишком часто. Подождите несколько секунд и попробуйте снова.')], flags: MessageFlags.Ephemeral }).catch(() => {});
      if (verdict === 'drop') return;
    }
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
        // «Где и для кого работает модуль» (bot/utils/moduleConfig.js): channels, roles without access, a pause
        const scope = feature && mc.SCOPE_MODULES.includes(feature.key) ? mc.scopeOf(featureSettings, feature.key) : null;
        if (scope && (scope.allow.length || scope.deny.length || scope.exceptRoles.length || scope.cooldown)) {
          const ch = interaction.channel;
          const verdict = mc.scopeAllows(scope, { channelId: interaction.channelId, parentId: ch?.isThread?.() ? ch.parentId : null, roles: [...(interaction.member?.roles?.cache?.keys?.() || interaction.member?.roles || [])] });
          if (!verdict.ok) {
            const where = verdict.why === 'role' ? 'Вам эта команда на сервере недоступна.' : `Эта команда работает ${verdict.allow ? `только в ${verdict.allow.slice(0, 5).map((c) => `<#${c}>`).join(', ')}` : 'не в этом канале'}.`;
            return await interaction.reply({ embeds: [embeds.info(where)], flags: MessageFlags.Ephemeral });
          }
          const left = mc.cooldownLeft(scope, interaction.guildId, feature.key, interaction.user?.id || '');
          if (left > 0) return await interaction.reply({ embeds: [embeds.info(`Подождите ${left} сек. перед следующей командой.`)], flags: MessageFlags.Ephemeral });
        }
        await require('../modules/branding').wrap(interaction).catch(() => {}); // the replies in the server's look
        await command.execute(interaction);
      } catch (err) {
        logger.error(`Command "${interaction.commandName}" failed:`, err);
        const payload = { embeds: [embeds.error(failureText(interaction, err, 'Произошла ошибка при выполнении команды.'))], flags: MessageFlags.Ephemeral };
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
        await tellFailed(interaction);
      }
      return;
    }

    for (const [matches, handle, label] of [[isGiveawayButton, handleGiveawayButton, 'Giveaway'], [isTicketButton, handleTicketButton, 'Ticket'], [require('../modules/polls').isPollButton, require('../modules/polls').handlePollButton, 'Poll']]) {
      if (!matches(interaction)) continue;
      try {
        await handle(interaction);
      } catch (err) {
        logger.error(`${label} button failed:`, err);
        const payload = { embeds: [embeds.error(failureText(interaction, err, 'Не получилось выполнить действие.'))], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
      return;
    }

    if (require('../modules/reports').isReportComponent(interaction)) {
      try { await require('../modules/reports').handleReportComponent(interaction); } catch (err) { logger.error('Report action failed:', err); await tellFailed(interaction); }
      return;
    }
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('repmodal:')) {
      try { await require('../commands/moderation/reportUser').handleModal(interaction); } catch (err) { logger.error('Report window failed:', err); await tellFailed(interaction); }
      return;
    }

    if (require('../modules/userData').isDmPrefButton(interaction)) { // «не присылать такие сообщения» under an optional DM
      try { await require('../modules/userData').handleDmPrefButton(interaction); } catch (err) { logger.error('DM preference failed:', err); await tellFailed(interaction); }
      return;
    }
    if (require('../modules/communities').isCommunityButton(interaction)) {
      try { await require('../modules/communities').handleCommunityButton(interaction); } catch (err) { logger.error('Community button failed:', err); await tellFailed(interaction); }
      return;
    }

    if (require('../modules/achievements').isAchievementComponent(interaction)) {
      try { await require('../modules/achievements').handleComponent(interaction); } catch (err) { logger.error('Achievements button failed:', err); await tellFailed(interaction); }
      return;
    }

    if (require('../modules/econ/components').isEconomyComponent(interaction)) {
      try { await require('../modules/econ/components').handleEconomyComponent(interaction); } catch (err) { logger.error('Economy action failed:', err); await tellFailed(interaction); }
      return;
    }

    if (require('../modules/interactive').isInteractive(interaction)) {
      await require('../modules/interactive').handleInteractive(interaction); // answers its own errors
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
        const payload = { embeds: [embeds.error(failureText(interaction, err, 'Не получилось выполнить действие.'))], flags: MessageFlags.Ephemeral };
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
        const payload = { embeds: [embeds.error(failureText(interaction, err, 'Не получилось выполнить действие.'))], flags: MessageFlags.Ephemeral };
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
