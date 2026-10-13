const { MemberProfile, GuildSettings, sequelize } = require('../../db');
const { withLock, withLocks } = require('../utils/lock');

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

// Settings are read on every message and every voice tick. The bot keeps them in memory for a few
// seconds (the web panel is another process, so a short TTL is how its changes arrive); any save done
// by this process drops the entry at once.
const SETTINGS_TTL_MS = 5000;
const settingsCache = new Map();
['afterSave', 'afterUpdate', 'afterDestroy', 'afterBulkUpdate', 'afterBulkDestroy'].forEach((hook) => GuildSettings.addHook(hook, () => settingsCache.clear()));

async function getOrCreateSettings(guildId) {
  const hit = settingsCache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.row;
  // findOne first: findOrCreate always opens a transaction, which is slow for a row that nearly always exists.
  const row = (await GuildSettings.findOne({ where: { guildId } })) || (await GuildSettings.findOrCreate({ where: { guildId } }))[0];
  settingsCache.set(guildId, { row, expires: Date.now() + SETTINGS_TTL_MS });
  return row;
}

async function getOrCreateProfile(guildId, userId) {
  const found = await MemberProfile.findOne({ where: { guildId, userId } });
  if (found) return found;
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

// Last time each member got message XP. Most messages fall inside the cooldown, and those are
// answered from memory without touching the database.
const lastXpGrant = new Map();

async function grantMessageXpUnlocked(guildId, userId) {
  const settings = await getOrCreateSettings(guildId);
  if (!settings.levelingEnabled || !settings.chatEnabled) return null;

  const memKey = `${guildId}:${userId}`;
  const seen = lastXpGrant.get(memKey);
  if (seen !== undefined && (Date.now() - seen) / 1000 < settings.xpCooldownSeconds) return null;

  const profile = await getOrCreateProfile(guildId, userId);
  const now = Date.now();
  if (profile.lastXpAt) {
    const elapsed = (now - new Date(profile.lastXpAt).getTime()) / 1000;
    if (elapsed < settings.xpCooldownSeconds) {
      lastXpGrant.set(memKey, new Date(profile.lastXpAt).getTime());
      return null;
    }
  }

  const gained = randomInt(settings.xpPerMessageMin, settings.xpPerMessageMax);
  const result = applyGain(profile, 'chat', gained, Math.max(0, Number(settings.chatCoinsPerMessage) || 0), settings);
  profile.lastXpAt = new Date();
  profile.messageCount = Number(profile.messageCount) + 1;
  await profile.save();
  if (lastXpGrant.size > 50000) lastXpGrant.clear();
  lastXpGrant.set(memKey, now);
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

/**
 * Voice XP for many members of one server at once (the once-a-minute tick). One query loads all
 * profiles, one transaction saves them — about 20x faster than one round trip per member.
 * Same per-member locks as grantVoiceXp, so a message sent at the same moment can't be lost.
 * Returns Map userId -> result of applyGain.
 */
function grantVoiceXpBatch(guildId, userIds, amount) {
  const ids = [...new Set(userIds)];
  const results = new Map();
  if (!ids.length) return Promise.resolve(results);
  return withLocks(ids.map((id) => `xp:${guildId}:${id}`), async () => {
    const settings = await getOrCreateSettings(guildId);
    const xp = Math.max(0, Number(amount) || 0);
    const coins = Math.max(0, Number(settings.voiceCoinsPerMinute) || 0);
    const byId = new Map((await MemberProfile.findAll({ where: { guildId, userId: ids } })).map((p) => [p.userId, p]));
    const rows = [];
    for (const id of ids) {
      // A member without a profile yet starts from a fresh one (nothing is created beforehand).
      const profile = byId.get(id) || MemberProfile.build({ guildId, userId: id });
      results.set(id, applyGain(profile, 'voice', xp, coins, settings));
      rows.push(profile);
    }
    // ONE statement for the whole group: insert, or update the XP/level/coin columns if the row exists.
    const now = new Date();
    const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const values = rows.flatMap((p) => [p.guildId, p.userId, p.xp, p.level, p.voiceXp, p.balance, p.crystals, now, now]);
    await sequelize.query(
      `INSERT INTO member_profiles (guildId, userId, xp, level, voiceXp, balance, crystals, createdAt, updatedAt) VALUES ${placeholders}
       ON CONFLICT (guildId, userId) DO UPDATE SET xp = excluded.xp, level = excluded.level, voiceXp = excluded.voiceXp,
         balance = excluded.balance, crystals = excluded.crystals, updatedAt = excluded.updatedAt`,
      { replacements: values }
    );
    return results;
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
  grantVoiceXpBatch,
  getLeaderboard,
  applyGain,
  levelsOf,
  TRACKS,
  TRACK_FIELDS
};
