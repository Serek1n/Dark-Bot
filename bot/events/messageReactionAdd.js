const { ReactionRole } = require('../../db');
const logger = require('../utils/logger');

function emojiKey(emoji) {
  return emoji.id ? emoji.id : emoji.name;
}

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    if (!reaction.message.guild) return;

    const rr = await ReactionRole.findOne({
      where: { messageId: reaction.message.id, emoji: emojiKey(reaction.emoji) }
    });
    if (!rr) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    const role = reaction.message.guild.roles.cache.get(rr.roleId);
    if (member && role) {
      member.roles.add(role).catch((err) => logger.warn('reaction-role add failed:', err.message));
    }
  }
};
