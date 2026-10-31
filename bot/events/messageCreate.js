const { findCustomCommand } = require('../modules/customCommands');
const { grantMessageXp, getOrCreateSettings } = require('../modules/leveling');
const { evaluate, handleViolation } = require('../modules/automod');
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
      const violation = await evaluate(settings, message);
      if (violation) {
        await handleViolation(settings, message, violation.reason, violation.key);
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
        const cmd = await findCustomCommand(message.guild.id, trigger);
        // Users may be mentioned, roles and @everyone never: anyone can call a command, and a command with a role in it would
        // let them ping that role as often as they like. One answer per person per channel every 3 seconds.
        const key = `${message.channelId}:${message.author.id}`;
        if (cmd && !(commandCooldown.get(key) > Date.now())) {
          if (commandCooldown.size > 5000) commandCooldown.clear();
          commandCooldown.set(key, Date.now() + 3000);
          // Templates: { member.* }, { guild.* }, { message.args.0 }, functions — only worked out when the text has them.
          const { buildMessage, usesTemplates } = require('../utils/messageBuilder');
          const uses = usesTemplates(cmd.response, cmd.embed);
          let fill = (t) => t;
          if (uses.full) {
            const { render, buildContext } = require('../utils/replacers');
            const level = uses.level ? await require('../modules/leveling').levelContext(message.guild.id, message.author.id).catch(() => null) : null;
            const ctx = buildContext({ member: message.member || { id: message.author.id, user: message.author }, guild: message.guild, message, level });
            fill = (t) => render(t, ctx);
          }
          const images = { avatar: message.author.displayAvatarURL?.({ extension: 'png', size: 256 }), icon: message.guild.iconURL?.({ extension: 'png', size: 256 }) };
          const built = buildMessage({ text: cmd.response, embed: cmd.embed, fill, images });
          if (built.content || built.embeds.length) {
            message.channel
              .send({ ...built, allowedMentions: { parse: ['users'] } })
              .catch(() => {});
          }
        }
      }
    }
  }
};
