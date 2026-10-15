const { CustomCommand } = require('../../db');
const { grantMessageXp, getOrCreateSettings } = require('../modules/leveling');
const { evaluateMessage, handleViolation } = require('../modules/automod');
const { announceLevelUp } = require('../utils/levelUp');
const { applyLevelRoles } = require('../modules/levelRoles');
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
        await handleViolation(settings, message, violation);
        return; // don't process leveling/custom commands for deleted messages
      }
    } catch (err) {
      logger.error('Automod error:', err);
    }

    // Leveling
    try {
      const result = await grantMessageXp(message.guild.id, message.author.id);
      if (result && message.member) await applyLevelRoles(message.member, result.levels, settings.levelRolesReplace);
      if (result?.leveledUp) {
        const target = settings.levelUpChannelId
          ? await message.guild.channels.fetch(settings.levelUpChannelId).catch(() => null)
          : message.channel;
        await announceLevelUp({
          guild: message.guild,
          user: message.author,
          displayName: message.member?.displayName,
          level: result.newLevel,
          channel: target || message.channel,
          crystals: result.crystals,
          crystalName: settings.crystalName
        });
      }
    } catch (err) {
      logger.error('Leveling error:', err);
    }

    // Custom commands (prefix-based, e.g. "!rules")
    const prefix = settings?.prefix || '!';
    if (settings.customCommandsEnabled && message.content.startsWith(prefix)) {
      const trigger = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (trigger) {
        const custom = await CustomCommand.findOne({ where: { guildId: message.guild.id, trigger } });
        if (custom) {
          message.channel
            .send({ content: custom.response, allowedMentions: { parse: ['users', 'roles'] } })
            .catch(() => {});
        }
      }
    }
  }
};
