// Automod for names: a member who changes the nickname to something banned (or puts "!" in front to sit on top of the list)
// gets it fixed right away. Joining members are checked in guildMemberAdd. Any change of a member also makes the panel
// read his access again (web/utils/access.js).
const { getOrCreateSettings } = require('../modules/leveling');
const { checkMemberName } = require('../modules/automod');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    if (!newMember?.guild || newMember.user?.bot) return;
    // «Права доступа» of the panel: roles or rights changed — the panel reads this member afresh on the next request
    try { require('../../web/utils/access').forget(newMember.guild.id, newMember.id); } catch { /* the panel is not in this process */ }
    if (!oldMember?.partial && oldMember?.displayName === newMember.displayName) return; // roles, boosts, timeouts: not a name change
    const settings = await getOrCreateSettings(newMember.guild.id).catch(() => null);
    if (!settings?.automodEnabled || (!settings.automodNicknames && !settings.automodDehoist)) return;
    await checkMemberName(newMember, settings);
  }
};
