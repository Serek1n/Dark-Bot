// A banned member's saved roles are forgotten: after an unban he returns without them.
const { forgetMember } = require('../modules/memberRestore');

module.exports = [
  { name: 'guildBanAdd', execute: async (ban) => { if (ban?.guild && ban?.user) await forgetMember(ban.guild.id, ban.user.id); } }
];
