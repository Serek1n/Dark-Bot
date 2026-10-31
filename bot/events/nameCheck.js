// Automod for names: a member who changes the nickname to something banned (or puts "!" in front to sit on top of the list)
// gets it fixed right away. Joining members are checked in guildMemberAdd.
const { getOrCreateSettings } = require('../modules/leveling');
const { checkMemberName } = require('../modules/automod');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    if (!newMember?.guild || newMember.user?.bot) return;
    if (!oldMember?.partial && oldMember?.displayName === newMember.displayName) return; // roles, boosts, timeouts: not a name change
    const settings = await getOrCreateSettings(newMember.guild.id).catch(() => null);
    if (!settings?.automodEnabled || (!settings.automodNicknames && !settings.automodDehoist)) return;
    await checkMemberName(newMember, settings);
  }
};
