const { ModLog, GuildSettings } = require('../../db');
const embeds = require('./embeds');

async function recordAndAnnounce(guild, { userId, moderatorId, action, reason }) {
  await ModLog.create({ guildId: guild.id, userId, moderatorId, action, reason: reason || 'Без причины' });

  const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
  if (!settings?.modLogChannelId) return;

  const channel = await guild.channels.fetch(settings.modLogChannelId).catch(() => null);
  if (!channel) return;

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

  const embed = embeds
    .baseEmbed()
    .setTitle(labels[action] || action)
    .addFields(
      { name: 'Участник', value: `<@${userId}>`, inline: true },
      { name: 'Модератор', value: `<@${moderatorId}>`, inline: true },
      { name: 'Причина', value: reason || 'Без причины' }
    );

  channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { recordAndAnnounce };
