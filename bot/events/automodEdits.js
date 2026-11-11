// An edited message goes through automod again: otherwise any content filter is passed by sending
// something harmless and then editing the forbidden text in.
const { getOrCreateSettings } = require('../modules/leveling');
const { evaluate, handleViolation } = require('../modules/automod');
const logger = require('../utils/logger');

module.exports = [
  {
    name: 'messageUpdate',
    execute: async (oldMessage, newMessage) => {
      try {
        let message = newMessage;
        if (!message?.guild) return;
        if (message.partial) message = await message.fetch().catch(() => null);
        if (!message || !message.author || message.author.bot || message.webhookId) return;
        if (oldMessage && !oldMessage.partial && oldMessage.content === message.content) return; // an embed appeared, a pin: the text is the same
        const settings = await getOrCreateSettings(message.guild.id);
        if (!settings.automodEnabled) return;
        if (!message.member) await message.guild.members.fetch(message.author.id).catch(() => null);
        const violation = await evaluate(settings, message, { edited: true });
        if (violation) await handleViolation(settings, message, violation.reason, violation.key);
      } catch (err) {
        logger.error('Automod (edit) error:', err);
      }
    }
  }
];
