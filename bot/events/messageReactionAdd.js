const { getOrCreateSettings } = require('../modules/leveling');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;
    // No fetch here: a partial reaction already knows its message id, server and emoji. Asking Discord for the
    // message on every reaction of every server would be a request wasted wherever nothing listens to reactions.
    if (!reaction.message.guild) return;
    await require('../modules/polls').oneAnswer(reaction, user).catch(() => {}); // a one-answer poll keeps one reaction per member
    if (!(await getOrCreateSettings(reaction.message.guild.id)).reactionRolesEnabled) return;

    await require('../modules/reactionRoles').handleReactionRole(reaction, user, true);
  }
};
