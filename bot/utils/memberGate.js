// Commands about another person (/profile, /level, /economy pay …) work only with people who are on this server and are not
// bots. Otherwise the bot would make a profile for anyone by ID, and that profile would show up in the server's top.
async function memberOf(guild, user) {
  if (!guild || !user) return null;
  return guild.members?.cache?.get(user.id) || (guild.members?.fetch ? guild.members.fetch(user.id).catch(() => null) : null);
}

/** null when the person is fine, otherwise the reason for the reply. */
async function refuseTarget(interaction, user, { bots = 'У ботов нет профиля, уровня и баланса.' } = {}) {
  if (!user) return 'Участник не найден.';
  if (user.bot) return bots;
  if (user.id === interaction.user?.id || !interaction.guild?.members) return null;
  const member = await memberOf(interaction.guild, user);
  return member ? null : 'Этого пользователя нет на сервере.';
}

module.exports = { memberOf, refuseTarget };
