const { ModLog, GuildSettings } = require('../../db');
const { getOrCreateSettings } = require('../modules/leveling');
const embeds = require('./embeds');
const serverLog = require('../modules/serverLog');
const { formatDuration } = require('./duration');
const { withLock } = require('./lock');

const LABELS = {
  warn: '⚠️ Предупреждение',
  unwarn: '✅ Снято предупреждение',
  mute: '🔇 Мут',
  unmute: '🔊 Размут',
  kick: '👢 Кик',
  ban: '🔨 Бан',
  unban: '♻️ Разбан',
  clear: '🧹 Очистка сообщений',
  automod: '🤖 Автомодерация',
  note: '📝 Заметка'
};

/** Writes a case with the next number of this server ("дело #N"); numbers never repeat, even for simultaneous actions. */
function createCase(guildId, data) {
  return withLock(`case:${guildId}`, async () => {
    const last = Number(await ModLog.max('caseNumber', { where: { guildId } })) || 0;
    const entry = await ModLog.create({ guildId, ...data, caseNumber: last + 1 });
    if (data.expiresAt && data.active) require('./scheduler').poke('mod'); // a temporary ban: the unban time may be the nearest one now
    return entry;
  });
}

function caseEmbed(entry) {
  const embed = embeds
    .baseEmbed()
    .setTitle(`${LABELS[entry.action] || entry.action}${entry.caseNumber ? ` · дело #${entry.caseNumber}` : ''}`)
    .addFields(
      { name: 'Участник', value: `<@${entry.userId}>`, inline: true },
      { name: 'Модератор', value: `<@${entry.moderatorId}>`, inline: true }
    );
  if (entry.duration) {
    embed.addFields({ name: 'Срок', value: formatDuration(Number(entry.duration)), inline: true });
  }
  embed.addFields({ name: 'Причина', value: String(entry.reason || 'Без причины').slice(0, 1000) });
  return embed;
}

/** Records the action as a case and publishes it to the "Логи" forum and the classic mod-log channel. Returns the case. */
async function recordAndAnnounce(guild, { userId, moderatorId, action, reason, duration = null, expiresAt = null, active = false }) {
  const entry = await createCase(guild.id, { userId, moderatorId, action, reason: String(reason || 'Без причины').slice(0, 1000), duration, expiresAt, active });

  // Tell the Discord-event log that this action is already known (a ban would be logged twice otherwise).
  serverLog.markReported(guild.id, userId, action);

  const settings = await getOrCreateSettings(guild.id);
  const embed = caseEmbed(entry);

  // The "Логи" forum (thread "Выдача наказаний") and, if set, the classic mod-log channel.
  serverLog.sendLog(guild.id, 'punishments', embed).catch(() => {});
  if (settings?.modLogChannelId) {
    const channel = await guild.channels.fetch(settings.modLogChannelId).catch(() => null);
    channel?.send({ embeds: [embed] }).catch(() => {});
  }
  return entry;
}

module.exports = { recordAndAnnounce, createCase, caseEmbed, LABELS };
