const { MemberProfile, GuildSettings, sequelize, inTransaction } = require('../../db');
const { withLock, withLocks } = require('../utils/lock');
const { QueryTypes } = require('sequelize');
const { ensureProfile } = require('./wallet');

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

// ---- Channel bonuses ----------------------------------------------------------------------------
// An admin can make some channels (or a whole category) pay more XP and coins, or nothing at all.
// Stored as JSON { "<channelId or categoryId>": { xp: 2, coins: 1.5 } }; a missing channel pays x1.
const MAX_BOOST = 10;
const parsedBoosts = new WeakMap(); // settings row -> parsed object (rows are re-read every few seconds)

function parseBoosts(json) {
  let raw = {};
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    raw = {};
  }
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!/^\d{15,25}$/.test(id) || !v || typeof v !== 'object') continue;
    const clamp = (n) => (Number.isFinite(Number(n)) ? Math.min(MAX_BOOST, Math.max(0, Math.round(Number(n) * 100) / 100)) : 1);
    out[id] = { xp: clamp(v.xp ?? 1), coins: clamp(v.coins ?? 1) };
  }
  return out;
}

/**
 * The multipliers for a place, from the most specific id to the least: the channel itself, then its
 * category (or the parent channel of a thread), then that parent's category. Nothing set = x1 / x1.
 */
function boostFor(settings, ids) {
  if (!settings) return { xp: 1, coins: 1 };
  let table = parsedBoosts.get(settings);
  if (!table) {
    table = parseBoosts(settings.channelBoosts);
    if (typeof settings === 'object') parsedBoosts.set(settings, table);
  }
  for (const id of ids || []) if (id && table[id]) return table[id];
  return { xp: 1, coins: 1 };
}

const scale = (value, multiplier) => Math.max(0, Math.round(value * multiplier));

const TRACKS = ['chat', 'voice'];
const MAX_LEVEL = 1000;

/**
 * Manual level change by an admin (web panel). mode: 'add' | 'remove' | 'set'.
 * The member lands exactly at the START of the target level (progress inside the level is reset).
 * Total XP always equals chat XP + voice XP, so the difference is taken from chat XP first
 * (and from voice XP if chat XP is not enough). Never below level 0, never above MAX_LEVEL.
 * Returns { level, previousLevel, xp, chatXp, voiceXp }.
 */
function computeLevelAdjust({ xp, chatXp, voiceXp }, mode, amount) {
  const current = levelFromXp(Number(xp) || 0);
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  const wanted = mode === 'set' ? n : mode === 'remove' ? current - n : current + n;
  const level = Math.min(MAX_LEVEL, Math.max(0, wanted));
  const newXp = totalXpForLevel(level);
  const delta = newXp - (Number(xp) || 0);
  let chat = Number(chatXp) || 0;
  let voice = Number(voiceXp) || 0;
  if (delta >= 0) {
    chat += delta;
  } else {
    const fromChat = Math.min(chat, -delta);
    chat -= fromChat;
    voice = Math.max(0, voice - (-delta - fromChat));
  }
  return { level, previousLevel: current, xp: newXp, chatXp: chat, voiceXp: voice };
}

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
 * The level and the crystals for a profile row that already received its XP. The level is worked out from the total XP and written
 * with a separate statement ("only if the stored level is lower"), so two gains at the same moment can never pay the crystals twice.
 */
async function settleLevel(row, xp, coins, settings, transaction) {
  const previousLevel = Number(row.level) || 0;
  const level = levelFromXp(Number(row.xp) || 0);
  let crystals = 0;
  if (level > previousLevel) {
    crystals = (level - previousLevel) * Math.max(0, Number(settings.crystalsPerLevel) || 0);
    const rows = await sequelize.query(
      'UPDATE member_profiles SET level = ?, crystals = crystals + ?, updatedAt = ? WHERE guildId = ? AND userId = ? AND level < ? RETURNING *',
      { replacements: [level, crystals, new Date(), row.guildId, row.userId, level], type: QueryTypes.SELECT, transaction }
    );
    if (rows.length) row = rows[0]; else crystals = 0;
  }
  return {
    leveledUp: crystals > 0 || level > previousLevel,
    newLevel: level,
    levels: { total: level },
    gained: xp,
    coins,
    crystals,
    profile: { ...row, level }
  };
}

/**
 * Gives XP and coins to one member with ONE additive statement (xp = xp + ?), so it never overwrites what another process
 * (the web panel, /pay, the shop) wrote in the meantime. `message: true` also stamps the cooldown and counts the message.
 */
async function addGain(guildId, userId, { track, xp, coins, settings, message = false }) {
  if (!TRACKS.includes(track)) throw new Error(`Unknown track: ${track}`);
  const col = `${track}Xp`;
  return inTransaction(async (transaction) => {
    await ensureProfile(guildId, userId, transaction);
    const now = new Date();
    const rows = await sequelize.query(
      `UPDATE member_profiles SET xp = xp + ?, ${col} = ${col} + ?, balance = balance + ?, updatedAt = ?${message ? ', lastXpAt = ?, messageCount = messageCount + 1' : ''}
       WHERE guildId = ? AND userId = ? RETURNING *`,
      { replacements: [xp, xp, coins, now, ...(message ? [now] : []), guildId, userId], type: QueryTypes.SELECT, transaction }
    );
    return settleLevel(rows[0], xp, coins, settings, transaction);
  });
}

/**
 * Award XP for an eligible message (chat direction). Returns the result of applyGain,
 * or null if on cooldown / the direction is switched off.
 */
function grantMessageXp(guildId, userId, where = []) {
  return withLock(`xp:${guildId}:${userId}`, () => grantMessageXpUnlocked(guildId, userId, where));
}

// Last time each member got message XP. Most messages fall inside the cooldown, and those are
// answered from memory without touching the database.
const lastXpGrant = new Map();

// `where`: ids of the channel, its category and so on (see boostFor); only used for the bonuses.
async function grantMessageXpUnlocked(guildId, userId, where = []) {
  const settings = await getOrCreateSettings(guildId);
  if (!settings.levelingEnabled || !settings.chatEnabled) return null;
  const boost = boostFor(settings, where);
  if (boost.xp === 0 && boost.coins === 0) return null; // a channel that pays nothing

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

  const gained = scale(randomInt(settings.xpPerMessageMin, settings.xpPerMessageMax), boost.xp);
  const coins = scale(Math.max(0, Number(settings.chatCoinsPerMessage) || 0), boost.coins);
  const result = await addGain(guildId, userId, { track: 'chat', xp: gained, coins, settings, message: true });
  if (lastXpGrant.size > 50000) lastXpGrant.clear();
  lastXpGrant.set(memKey, now);
  return result;
}

/**
 * Award voice XP and coins for one minute in a voice channel (voice direction).
 * `amount` is the XP for that minute; coins come from the server settings.
 */
function grantVoiceXp(guildId, userId, amount, coinMultiplier = 1) {
  return withLock(`xp:${guildId}:${userId}`, async () => {
    const settings = await getOrCreateSettings(guildId);
    const coins = scale(Math.max(0, Number(settings.voiceCoinsPerMinute) || 0), coinMultiplier);
    return addGain(guildId, userId, { track: 'voice', xp: Math.max(0, Number(amount) || 0), coins, settings });
  });
}

/**
 * Voice XP for many members of one server at once (the once-a-minute tick). One additive statement
 * writes the whole group — about 20x faster than one round trip per member.
 * Same per-member locks as grantVoiceXp, so a message sent at the same moment can't be lost.
 * Returns Map userId -> result of applyGain.
 */
function grantVoiceXpBatch(guildId, userIds, amount, coinMultiplier = 1) {
  const ids = [...new Set(userIds)];
  const results = new Map();
  if (!ids.length) return Promise.resolve(results);
  return withLocks(ids.map((id) => `xp:${guildId}:${id}`), async () => {
    const settings = await getOrCreateSettings(guildId);
    const xp = Math.max(0, Number(amount) || 0);
    const coins = scale(Math.max(0, Number(settings.voiceCoinsPerMinute) || 0), coinMultiplier);
    const now = new Date();
    // ONE statement for the whole group that ADDS to the existing numbers (a new member gets a row): nobody else's change is overwritten.
    const placeholders = ids.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
    await inTransaction(async (transaction) => {
      await sequelize.query(
        `INSERT INTO member_profiles (guildId, userId, xp, voiceXp, balance, createdAt, updatedAt) VALUES ${placeholders}
         ON CONFLICT (guildId, userId) DO UPDATE SET xp = member_profiles.xp + excluded.xp, voiceXp = member_profiles.voiceXp + excluded.voiceXp,
           balance = member_profiles.balance + excluded.balance, updatedAt = excluded.updatedAt`,
        { replacements: ids.flatMap((id) => [guildId, id, xp, xp, coins, now, now]), transaction }
      );
      const rows = await sequelize.query('SELECT * FROM member_profiles WHERE guildId = ? AND userId IN (?)', { replacements: [guildId, ids], type: QueryTypes.SELECT, transaction });
      for (const row of rows) results.set(row.userId, await settleLevel(row, xp, coins, settings, transaction));
    });
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
  parseBoosts,
  boostFor,
  MAX_BOOST,
  computeLevelAdjust,
  MAX_LEVEL,
  levelsOf,
  TRACKS,
  TRACK_FIELDS
};
