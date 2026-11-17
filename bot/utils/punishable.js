// Can the bot punish this member, and if not — exactly why. Discord's own rules, checked before calling the API
// (discord.js `moderatable` mixes four different reasons into one false, so "его роль выше моей" was shown even when
// the real cause was the Administrator right or a missing bot permission), and the API's real answer mapped to words
// when the call fails anyway.
const { PermissionFlagsBits } = require('discord.js');

const NEED = {
  mute: [PermissionFlagsBits.ModerateMembers, '«Отправить участников подумать» (тайм-аут)'],
  unmute: [PermissionFlagsBits.ModerateMembers, '«Отправить участников подумать» (тайм-аут)'],
  kick: [PermissionFlagsBits.KickMembers, '«Выгонять участников»'],
  ban: [PermissionFlagsBits.BanMembers, '«Банить участников»']
};
const VERB = { mute: 'замутить', unmute: 'размутить', kick: 'выгнать', ban: 'забанить' };

/** null when the bot can do `action` (mute | unmute | kick | ban) to `member`, else a sentence explaining why not. */
function whyCannot(guild, member, action) {
  const verb = VERB[action] || 'наказать';
  if (!member) return null; // not on the server: only a ban is possible, and Discord decides
  const me = guild.members?.me;
  if (member.id === guild.client?.user?.id) return `Нельзя ${verb} самого бота.`;
  if (member.id === guild.ownerId) return `Нельзя ${verb} владельца сервера — Discord этого не позволяет.`;
  const [flag, name] = NEED[action] || [];
  if (flag && me && !me.permissions?.has?.(flag)) return `У бота нет права ${name}. Выдайте его роли бота в настройках сервера.`;
  if ((action === 'mute' || action === 'unmute') && member.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    return 'У участника право «Администратор» — Discord не даёт тайм-аут администраторам. Снимите это право или накажите иначе.';
  }
  const mine = me?.roles?.highest; const theirs = member.roles?.highest;
  if (mine && theirs && guild.ownerId !== me.id && theirs.comparePositionTo?.(mine) >= 0) {
    const same = theirs.id === mine.id;
    return same
      ? `У участника та же высшая роль, что у бота (@${mine.name}). Поднимите роль бота выше в настройках сервера → Роли.`
      : `Высшая роль участника (@${theirs.name}) стоит выше роли бота (@${mine.name}). Поднимите роль бота выше в настройках сервера → Роли.`;
  }
  return null;
}

/** A Discord API error as a sentence (50013 = missing permissions, 10007 = unknown member, ...). */
function apiErrorText(err, action) {
  const code = Number(err?.code);
  if (code === 50013) return `Discord отказал: у бота недостаточно прав, чтобы ${VERB[action] || 'наказать'} этого участника (проверьте права и порядок ролей).`;
  if (code === 10007) return 'Участника уже нет на сервере.';
  if (code === 10013) return 'Такого пользователя нет в Discord.';
  if (code === 50035) return 'Discord не принял срок наказания (тайм-аут — не дольше 28 дней).';
  if (err?.status === 429 || code === 429) return 'Discord временно ограничил запросы — попробуйте через минуту.';
  return err?.message ? `Discord ответил ошибкой: ${err.message}` : 'Неизвестная ошибка Discord.';
}

module.exports = { whyCannot, apiErrorText, VERB };
