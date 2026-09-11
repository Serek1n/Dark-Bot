const { CustomCommand } = require('../../db');
const { grantMessageXp, getOrCreateSettings } = require('../modules/leveling');
const { evaluateMessage, logModAction } = require('../modules/automod');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    // getOrCreateSettings ensures a row always exists (with sensible defaults like
    // levelingEnabled: true) even on a brand-new guild where no admin has touched
    // /settings, /automod or the web dashboard yet — otherwise leveling silently
    // never starts working out of the box.
    const settings = await getOrCreateSettings(message.guild.id);

    // Automod
    try {
      const violation = await evaluateMessage(settings, message);
      if (violation) {
        await message.delete().catch(() => {});
        await logModAction(message.guild.id, message.author.id, message.client.user.id, 'automod', violation);
        if (settings.modLogChannelId) {
          const logChannel = await message.guild.channels.fetch(settings.modLogChannelId).catch(() => null);
          logChannel
            ?.send({
              embeds: [
                embeds
                  .error(`Сообщение от <@${message.author.id}> удалено автомодерацией`)
                  .addFields({ name: 'Причина', value: violation })
              ]
            })
            .catch(() => {});
        }
        return; // don't process leveling/custom commands for deleted messages
      }
    } catch (err) {
      logger.error('Automod error:', err);
    }

    // Leveling
    try {
      const result = await grantMessageXp(message.guild.id, message.author.id);
      if (result?.leveledUp) {
        const text = `🎉 <@${message.author.id}>, новый уровень: **${result.newLevel}**!`;
        const target = settings.levelUpChannelId
          ? await message.guild.channels.fetch(settings.levelUpChannelId).catch(() => null)
          : message.channel;
        (target || message.channel).send(text).catch(() => {});
      }
    } catch (err) {
      logger.error('Leveling error:', err);
    }

    // Custom commands (prefix-based, e.g. "!rules")
    const prefix = settings?.prefix || '!';
    if (message.content.startsWith(prefix)) {
      const trigger = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (trigger) {
        const custom = await CustomCommand.findOne({ where: { guildId: message.guild.id, trigger } });
        if (custom) {
          message.channel.send(custom.response).catch(() => {});
        }
      }
    }
  }
};
