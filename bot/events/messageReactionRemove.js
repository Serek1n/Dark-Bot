const { getOrCreateSettings } = require('../modules/leveling');

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    if (!reaction.message.guild) return;
    await require('../modules/starboard').handleStarReaction(reaction, user); // "Доска почёта"; reaction roles below
    if (!(await getOrCreateSettings(reaction.message.guild.id)).reactionRolesEnabled) return;

    await require('../modules/reactionRoles').handleReactionRole(reaction, user, false);
  }
};
