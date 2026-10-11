const embeds = require('./embeds');

/** Posts the "level up" embed. `channel` falls back to the server's system channel. */
function announceLevelUp({ guild, user, displayName, level, channel }) {
  const target = channel || guild.systemChannel;
  if (!target?.send) return Promise.resolve();
  const embed = embeds
    .baseEmbed()
    .setTimestamp(null)
    .setAuthor({ name: displayName || user.username, iconURL: user.displayAvatarURL?.() })
    .setTitle('Поздравляю с повышением уровня! ✨')
    .setDescription(`Твой уровень повышен до ${level}-го!`)
    .setFooter({ text: guild.name, iconURL: guild.iconURL?.() || undefined });
  return target.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { announceLevelUp };
