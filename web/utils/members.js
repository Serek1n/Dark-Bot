// Manual changes in the panel (coins, levels) are for people on the server only: not for bots (the bot itself included)
// and not for an ID of someone who is not there — otherwise that ID gets a profile and shows up in the server's top.
const { getClient } = require('../botBridge');

/** null when fine, 'isbot' or 'notmember' otherwise. If Discord cannot be asked, the change is refused too. */
async function memberProblem(guildId, userId) {
  if (String(userId) === String(process.env.DISCORD_CLIENT_ID)) return 'isbot';
  const guild = getClient()?.guilds.cache.get(guildId);
  if (guild) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) return 'notmember';
    return member.user?.bot ? 'isbot' : null;
  }
  const { botApi } = require('../discordApi');
  try {
    const { data } = await botApi.get(`/guilds/${guildId}/members/${userId}`);
    return data?.user?.bot ? 'isbot' : null;
  } catch {
    return 'notmember';
  }
}

module.exports = { memberProblem };
