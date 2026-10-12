const { MemberProfile, GuildSettings } = require('../../db');
const { withLock } = require('../utils/lock');

// XP needed to go from level N to N+1. Classic MEE6-style curve.
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

/** Total XP at which `level` begins. */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

function levelFromXp(xp) {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return level;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getOrCreateSettings(guildId) {
  const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
  return settings;
}

async function getOrCreateProfile(guildId, userId) {
  const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
  return profile;
}

const TRACKS = ['chat', 'voice'];

/**
 * ONE level for everyone: `xp` / `level` are the total of chat XP and voice XP. The two sources
 * are also stored separately (chatXp / voiceXp) so they can have their own settings and a voice
 * leaderboard. Currencies: coins come from activity, crystals are paid for every new level.
 */
function levelsOf(profile) {
  return { total: profile.level };
}

/** Adds XP and income to a profile object (not saved). Returns what happened. */
function applyGain(profile, track, xp, coins, settings) {
  const previousLevel = profile.level;
  profile[`${track}Xp`] = Number(profile[`${track}Xp`] || 0) + xp;
  profile.xp = Number(profile.xp || 0) + xp;
  profile.level = levelFromXp(profile.xp);
  profile.balance = Number(profile.balance || 0) + coins;

  const crystals = Math.max(0, profile.level - previousLevel) * Math.max(0, Number(settings.crystalsPerLevel) || 0);
  profile.crystals = Number(profile.crystals || 0) + crystals;

  return {
    leveledUp: profile.level > previousLevel,
    newLevel: profile.level,
    levels: levelsOf(profile),
    gained: xp,
    coins,
    crystals,
    profile
  };
}

/**
 * Award XP for an eligible message (chat direction). Returns the result of applyGain,
 * or null if on cooldown / the direction is switched off.
 */
function grantMessageXp(guildId, userId) {
  return withLock(`xp:${guildId}:${userId}`, () => grantMessageXpUnlocked(guildId, userId));
}

async function grantMessageXpUnlocked(guildId, userId) {
  const settings = await getOrCreateSettings(guildId);
  if (!settings.levelingEnabled || !settings.chatEnabled) return null;

  const profile = await getOrCreateProfile(guildId, userId);
  const now = Date.now();
  if (profile.lastXpAt) {
    const elapsed = (now - new Date(profile.lastXpAt).getTime()) / 1000;
    if (elapsed < settings.xpCooldownSeconds) return null;
  }

  const gained = randomInt(settings.xpPerMessageMin, settings.xpPerMessageMax);
  const result = applyGain(profile, 'chat', gained, Math.max(0, Number(settings.chatCoinsPerMessage) || 0), settings);
  profile.lastXpAt = new Date();
  profile.messageCount = Number(profile.messageCount) + 1;
  await profile.save();
  return result;
}

/**
 * Award voice XP and coins for one minute in a voice channel (voice direction).
 * `amount` is the XP for that minute; coins come from the server settings.
 */
function grantVoiceXp(guildId, userId, amount) {
  return withLock(`xp:${guildId}:${userId}`, async () => {
    const settings = await getOrCreateSettings(guildId);
    const profile = await getOrCreateProfile(guildId, userId);
    const result = applyGain(profile, 'voice', Math.max(0, Number(amount) || 0), Math.max(0, Number(settings.voiceCoinsPerMinute) || 0), settings);
    await profile.save();
    return result;
  });
}

const TRACK_FIELDS = { total: 'xp', chat: 'chatXp', voice: 'voiceXp' };

async function getLeaderboard(guildId, limit = 10, track = 'total') {
  return MemberProfile.findAll({
    where: { guildId },
    order: [[TRACK_FIELDS[track] || 'xp', 'DESC']],
    limit
  });
}

module.exports = {
  xpForLevel,
  totalXpForLevel,
  levelFromXp,
  getOrCreateSettings,
  getOrCreateProfile,
  grantMessageXp,
  grantVoiceXp,
  getLeaderboard,
  applyGain,
  levelsOf,
  TRACKS,
  TRACK_FIELDS
};
