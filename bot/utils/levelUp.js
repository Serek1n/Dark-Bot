const embeds = require('./embeds');

/**
 * The voice channel whose chat should get the announcement: the one the member is sitting in right now (not the AFK one).
 * Null when the member is not in voice or the server switched this off. Whether the bot may write there is checked on sending.
 */
function voiceChatOf(guild, member, settings) {
  if (settings && settings.levelUpInVoice === false) return null;
  const voice = member?.voice?.channel;
  if (!voice || voice.id === guild.afkChannelId || !voice.send) return null;
  if (voice.isTextBased && !voice.isTextBased()) return null;
  return voice;
}

/**
 * The one place for the announcement: the chat of the member's voice channel (if the server keeps that on); otherwise the
 * server's level-up channel; when none is chosen — the channel where the level was reached (`here`), or the server's system
 * channel for levels from voice. There is no second try: if the bot can't write to that place, nothing is sent.
 * A chosen level-up channel that was deleted means nothing is sent either.
 */
async function levelUpTarget({ guild, member, settings, fallback: here = null }) {
  const voice = voiceChatOf(guild, member, settings);
  if (voice) return { channel: voice, fallback: null };
  if (settings?.levelUpChannelId) {
    const configured = guild.channels.cache?.get(settings.levelUpChannelId) || (await guild.channels.fetch(settings.levelUpChannelId).catch(() => null));
    return { channel: configured || null, fallback: null };
  }
  return { channel: here || guild.systemChannel || null, fallback: null };
}

/** Can the bot post this message there right now? */
function canPost(channel, guild, withEmbed) {
  const perms = channel?.permissionsFor?.(guild.members?.me);
  if (!perms) return Boolean(channel?.send);
  return perms.has(['ViewChannel', 'SendMessages', ...(withEmbed ? ['EmbedLinks'] : [])]);
}

const DESTINATIONS = ['auto', 'dm', 'off'];
const DEFAULT_TEXT = 'Твой уровень повышен до {level}-го!';

/** The text of a level-up message with its {placeholders} filled in. */
function fillLevelUpText(template, v, ctx = {}) {
  const { render } = require('./replacers');
  return render(template || DEFAULT_TEXT, ctx, {
    user: `<@${v.userId}>`, name: v.name, level: v.level, oldLevel: v.oldLevel ?? Math.max(0, v.level - 1),
    server: v.server, crystals: v.crystals || 0, role: v.roleName || ''
  }).slice(0, 2000);
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
  const { parseEmbed, buildMessage, hasBody, usesTemplates } = require('./messageBuilder');
  const own = parseEmbed(settings?.levelUpEmbedData);
  const ownEmbed = own && hasBody(own) ? own : null; // the server designed its own frame
  const uses = usesTemplates(custom, ownEmbed);
  let ctx = {};
  if (uses.full) { // full templates only when the text uses them
    const { buildContext } = require('./replacers');
    const lvl = uses.level ? await require('../modules/leveling').levelContext(guild.id, user.id).catch(() => null) : null;
    ctx = buildContext({ member: member || { id: user.id, user, displayName }, guild, level: lvl });
  }
  const text = fillLevelUpText(custom || DEFAULT_TEXT, { userId: user.id, name: displayName || user.username, level, oldLevel, server: guild.name, crystals, roleName }, ctx);
  const framed = !custom || settings?.levelUpEmbed !== false;

  const vars = { userId: user.id, name: displayName || user.username, level, oldLevel, server: guild.name, crystals, roleName };
  let payload;
  if (ownEmbed) {
    const images = { avatar: user.displayAvatarURL?.({ extension: 'png', size: 256 }), icon: guild.iconURL?.({ extension: 'png', size: 256 }) };
    const built = buildMessage({ text: custom || '', embed: ownEmbed, fill: (t) => fillLevelUpText(t, vars, ctx), images });
    payload = { ...built, allowedMentions: { users: [user.id] } };
  } else if (framed) {
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
  // Only the place chosen for it: if the bot can't write there, the congratulation is skipped, never sent somewhere else.
  const target = channel;
  if (!target?.send || !canPost(target, guild, Boolean(payload.embeds?.length))) return;
  await target.send(payload).catch(() => {});
}

module.exports = { announceLevelUp, levelUpTarget, voiceChatOf, canPost, shouldAnnounce, fillLevelUpText, DESTINATIONS, DEFAULT_TEXT };
