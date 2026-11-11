const { getOrCreateSettings } = require('../modules/leveling');

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    if (user.bot) return;
    // No fetch here: a partial reaction already knows its message id, server and emoji. Asking Discord for the
    // message on every reaction of every server would be a request wasted wherever nothing listens to reactions.
    if (!reaction.message.guild) return;
    await require('../modules/starboard').handleStarReaction(reaction, user); // "Доска почёта"; reaction roles below
    if (!(await getOrCreateSettings(reaction.message.guild.id)).reactionRolesEnabled) return;

    await require('../modules/reactionRoles').handleReactionRole(reaction, user, false);
  }
};
