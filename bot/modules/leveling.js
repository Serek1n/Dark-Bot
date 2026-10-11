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

/**
 * Award XP for an eligible message. Returns { leveledUp, newLevel, profile } or null if on cooldown/disabled.
 */
function grantMessageXp(guildId, userId) {
  return withLock(`xp:${guildId}:${userId}`, () => grantMessageXpUnlocked(guildId, userId));
}

async function grantMessageXpUnlocked(guildId, userId) {
  const settings = await getOrCreateSettings(guildId);
  if (!settings.levelingEnabled) return null;

  const profile = await getOrCreateProfile(guildId, userId);
  const now = Date.now();
  if (profile.lastXpAt) {
    const elapsed = (now - new Date(profile.lastXpAt).getTime()) / 1000;
    if (elapsed < settings.xpCooldownSeconds) return null;
  }

  const gained = randomInt(settings.xpPerMessageMin, settings.xpPerMessageMax);
  const previousLevel = profile.level;
  profile.xp = Number(profile.xp) + gained;
  profile.balance = Number(profile.balance) + Math.ceil(gained / 2);
  profile.level = levelFromXp(profile.xp);
  profile.lastXpAt = new Date();
  profile.messageCount = Number(profile.messageCount) + 1;
  await profile.save();

  return {
    leveledUp: profile.level > previousLevel,
    newLevel: profile.level,
    gained,
    profile
  };
}

/** Award a fixed amount of XP (used for time spent in voice). Same result shape as grantMessageXp. */
function grantVoiceXp(guildId, userId, amount) {
  return withLock(`xp:${guildId}:${userId}`, async () => {
    const profile = await getOrCreateProfile(guildId, userId);
    const previousLevel = profile.level;
    profile.xp = Number(profile.xp) + amount;
    profile.balance = Number(profile.balance) + Math.ceil(amount / 2);
    profile.level = levelFromXp(profile.xp);
    await profile.save();
    return { leveledUp: profile.level > previousLevel, newLevel: profile.level, gained: amount, profile };
  });
}

async function getLeaderboard(guildId, limit = 10) {
  return MemberProfile.findAll({
    where: { guildId },
    order: [['xp', 'DESC']],
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
  getLeaderboard
};
