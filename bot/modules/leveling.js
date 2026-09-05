const { MemberProfile, GuildSettings } = require('../../db');

// XP needed to go from level N to N+1. Classic MEE6-style curve.
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
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
async function grantMessageXp(guildId, userId) {
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

async function getLeaderboard(guildId, limit = 10) {
  return MemberProfile.findAll({
    where: { guildId },
    order: [['xp', 'DESC']],
    limit
  });
}

module.exports = {
  xpForLevel,
  levelFromXp,
  getOrCreateSettings,
  getOrCreateProfile,
  grantMessageXp,
  getLeaderboard
};
