const embeds = require('./embeds');

/**
 * The voice channel whose chat should get the announcement: the one the member is sitting in right now.
 * Not the AFK channel, and only when the bot can see and write there. Null otherwise.
 */
function voiceChatOf(guild, member, settings) {
  if (settings && settings.levelUpInVoice === false) return null;
  const voice = member?.voice?.channel;
  if (!voice || voice.id === guild.afkChannelId || !voice.send) return null;
  if (voice.isTextBased && !voice.isTextBased()) return null;
  const perms = voice.permissionsFor?.(guild.members?.me);
  if (perms && !perms.has(['ViewChannel', 'SendMessages'])) return null;
  return voice;
}

/**
 * Where to announce a new level. A member who is in a voice channel gets it in that channel's chat
 * (if the server did not switch that off); otherwise the server's level-up channel, otherwise `fallback`.
 * Returns { channel, fallback }: `fallback` is tried when the first one cannot be written to.
 */
async function levelUpTarget({ guild, member, settings, fallback = null }) {
  const configured = settings?.levelUpChannelId
    ? guild.channels.cache?.get(settings.levelUpChannelId) || (await guild.channels.fetch(settings.levelUpChannelId).catch(() => null))
    : null;
  const usual = configured || fallback;
  const voice = voiceChatOf(guild, member, settings);
  return voice ? { channel: voice, fallback: usual } : { channel: usual, fallback: null };
}

/** Posts the "level up" embed. `channel` falls back to the server's system channel. */
async function announceLevelUp({ guild, user, displayName, level, channel, fallback = null, crystals, crystalName }) {
  const target = channel || fallback || guild.systemChannel;
  if (!target?.send) return;
  const embed = embeds
    .baseEmbed()
    .setTimestamp(null)
    .setAuthor({ name: displayName || user.username, iconURL: user.displayAvatarURL?.() })
    .setTitle('Поздравляю с повышением уровня! ✨')
    .setDescription(`Твой уровень повышен до ${level}-го!` + (crystals > 0 ? `\n+${crystals} ${crystalName || 'кристаллы'}` : ''))
    .setFooter({ text: guild.name, iconURL: guild.iconURL?.() || undefined });
  try {
    await target.send({ embeds: [embed] });
  } catch {
    // The voice chat may be closed for the bot: use the usual channel instead of losing the message.
    const other = fallback && fallback !== target ? fallback : guild.systemChannel && guild.systemChannel !== target ? guild.systemChannel : null;
    if (other?.send) await other.send({ embeds: [embed] }).catch(() => {});
  }
}

module.exports = { announceLevelUp, levelUpTarget, voiceChatOf };
