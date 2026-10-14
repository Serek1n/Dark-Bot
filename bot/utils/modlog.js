const { ModLog, GuildSettings } = require('../../db');
const embeds = require('./embeds');
const serverLog = require('../modules/serverLog');

async function recordAndAnnounce(guild, { userId, moderatorId, action, reason }) {
  await ModLog.create({ guildId: guild.id, userId, moderatorId, action, reason: reason || 'Без причины' });

  // Tell the Discord-event log that this action is already known (a ban would be logged twice otherwise).
  serverLog.markReported(guild.id, userId, action);

  const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });

  const labels = {
    warn: '⚠️ Предупреждение',
    unwarn: '✅ Снято предупреждение',
    mute: '🔇 Мут',
    unmute: '🔊 Размут',
    kick: '👢 Кик',
    ban: '🔨 Бан',
    unban: '♻️ Разбан',
    clear: '🧹 Очистка сообщений',
    automod: '🤖 Автомодерация'
  };

  const shownReason = String(reason || 'Без причины').slice(0, 1000);
  const embed = embeds
    .baseEmbed()
    .setTitle(labels[action] || action)
    .addFields(
      { name: 'Участник', value: `<@${userId}>`, inline: true },
      { name: 'Модератор', value: `<@${moderatorId}>`, inline: true },
      { name: 'Причина', value: shownReason }
    );

  // The "Логи" forum (thread "Выдача наказаний") and, if set, the classic mod-log channel.
  serverLog.sendLog(guild.id, 'punishments', embed).catch(() => {});
  if (!settings?.modLogChannelId) return;
  const channel = await guild.channels.fetch(settings.modLogChannelId).catch(() => null);
  channel?.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { recordAndAnnounce };
