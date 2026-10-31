const { findCustomResponse } = require('../modules/customCommands');
const { grantMessageXp, getOrCreateSettings } = require('../modules/leveling');
const { evaluateMessage, handleViolation } = require('../modules/automod');
const { announceLevelUp, levelUpTarget } = require('../utils/levelUp');
const { applyLevelRoles } = require('../modules/levelRoles');
const logger = require('../utils/logger');

const commandCooldown = new Map(); // "channel:user" -> time until which a custom command is not answered again

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
      // Where the message was written, for the channel bonuses: the channel, its category (or, in a thread, the parent channel and its category)
      const ch = message.channel;
      const where = [message.channelId, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
      const result = await grantMessageXp(message.guild.id, message.author.id, where, message.member);
      if (result && message.member) await applyLevelRoles(message.member, result.levels, settings.levelRolesReplace);
      if (result?.leveledUp) {
        const { channel, fallback } = await levelUpTarget({ guild: message.guild, member: message.member, settings, fallback: message.channel });
        await announceLevelUp({
          guild: message.guild,
          user: message.author,
          displayName: message.member?.displayName,
          level: result.newLevel,
          oldLevel: result.previousLevel,
          settings,
          member: message.member,
          channel: channel || message.channel,
          fallback,
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
        const response = await findCustomResponse(message.guild.id, trigger);
        // Users may be mentioned, roles and @everyone never: anyone can call a command, and a command with a role in it would
        // let them ping that role as often as they like. One answer per person per channel every 3 seconds.
        const key = `${message.channelId}:${message.author.id}`;
        if (response !== null && !(commandCooldown.get(key) > Date.now())) {
          if (commandCooldown.size > 5000) commandCooldown.clear();
          commandCooldown.set(key, Date.now() + 3000);
          // Templates: { member.* }, { guild.* }, { message.args.0 }, functions — only worked out when the text has them.
          let content = response;
          if (/\{\s*[a-z_]+\.|\{-/.test(response)) {
            const { render, buildContext } = require('../utils/replacers');
            const level = response.includes('level.') ? await require('../modules/leveling').levelContext(message.guild.id, message.author.id).catch(() => null) : null;
            content = render(response, buildContext({ member: message.member || { id: message.author.id, user: message.author }, guild: message.guild, message, level })).slice(0, 2000);
          }
          message.channel
            .send({ content, allowedMentions: { parse: ['users'] } })
            .catch(() => {});
        }
      }
    }
  }
};
