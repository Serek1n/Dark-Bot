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

const DESTINATIONS = ['auto', 'dm', 'off'];
const DEFAULT_TEXT = 'Твой уровень повышен до {level}-го!';

/** The text of a level-up message with its {placeholders} filled in. */
function fillLevelUpText(template, v) {
  return String(template || DEFAULT_TEXT)
    .replaceAll('{user}', `<@${v.userId}>`)
    .replaceAll('{name}', v.name)
    .replaceAll('{level}', String(v.level))
    .replaceAll('{oldLevel}', String(v.oldLevel ?? Math.max(0, v.level - 1)))
    .replaceAll('{server}', v.server)
    .replaceAll('{crystals}', String(v.crystals || 0))
    .replaceAll('{role}', v.roleName || '')
    .slice(0, 2000);
}

/**
 * Whether this level gets an announcement (ideas from Polaris): the message can be switched off, limited to every N-th level
 * (up to level X, after which every level is announced again: early levels come fast, later ones are rare), or to levels that give a role.
 */
function shouldAnnounce(settings, level, rewardLevels = []) {
  const dest = DESTINATIONS.includes(settings?.levelUpDestination) ? settings.levelUpDestination : 'auto';
  if (dest === 'off') return false;
  if (settings?.levelUpRewardOnly && !rewardLevels.includes(level)) return false;
  const every = Math.max(1, Number(settings?.levelUpEvery) || 1);
  const until = Math.max(0, Number(settings?.levelUpEveryUntil) || 0);
  if (every > 1 && (until === 0 || level < until) && level % every !== 0) return false;
  return true;
}

/** Posts the "level up" message following the server's settings. `channel` falls back to the server's system channel. */
async function announceLevelUp({ guild, user, displayName, level, oldLevel, channel, fallback = null, crystals, crystalName, settings = null, member = null }) {
  const rewards = settings ? await require('../modules/levelRoles').getLevelRoles(guild.id).catch(() => []) : [];
  // A jump over several levels at once is announced if any of the levels passed qualifies.
  const from = Math.max(Number(oldLevel ?? level - 1) + 1, level - 50);
  let due = false;
  for (let l = from; l <= level && !due; l++) due = shouldAnnounce(settings, l, rewards.map((r) => r.level));
  if (!due) return;
  const reward = rewards.find((r) => r.level === level);
  const roleName = reward ? guild.roles?.cache?.get?.(reward.roleId)?.name || '' : '';
  const custom = settings?.levelUpMessage && String(settings.levelUpMessage).trim();
  const text = fillLevelUpText(custom || DEFAULT_TEXT, { userId: user.id, name: displayName || user.username, level, oldLevel, server: guild.name, crystals, roleName });
  const framed = !custom || settings?.levelUpEmbed !== false;

  let payload;
  if (framed) {
    const embed = embeds
      .baseEmbed()
      .setTimestamp(null)
      .setAuthor({ name: displayName || user.username, iconURL: user.displayAvatarURL?.() || undefined })
      .setTitle(custom ? null : 'Поздравляю с повышением уровня! ✨')
      .setDescription(text + (!custom && crystals > 0 ? `\n+${crystals} ${crystalName || 'кристаллы'}` : ''))
      .setFooter({ text: guild.name, iconURL: guild.iconURL?.() || undefined });
    payload = { embeds: [embed], allowedMentions: { parse: [] } };
  } else {
    payload = { content: text, allowedMentions: { users: [user.id] } }; // the plain text may ping the member, nobody else
  }

  if (settings?.levelUpDestination === 'dm') {
    const target = member || user;
    await target.send?.(payload).catch(() => {}); // closed DMs: nothing to do
    return;
  }
  const target = channel || fallback || guild.systemChannel;
  if (!target?.send) return;
  try {
    await target.send(payload);
  } catch {
    // The voice chat may be closed for the bot: use the usual channel instead of losing the message.
    const other = fallback && fallback !== target ? fallback : guild.systemChannel && guild.systemChannel !== target ? guild.systemChannel : null;
    if (other?.send) await other.send(payload).catch(() => {});
  }
}

module.exports = { announceLevelUp, levelUpTarget, voiceChatOf, shouldAnnounce, fillLevelUpText, DESTINATIONS, DEFAULT_TEXT };
