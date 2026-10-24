const { MemberProfile } = require('../../db');
const { xpForLevel, totalXpForLevel, levelFromXp } = require('./leveling');

// Numbers from an uploaded file are clamped: a value like 1e400 must not reach the database or the level loop.
const MAX_XP_PART = totalXpForLevel(500);
const MAX_MONEY = 1e12;
const MAX_COUNT = 1e9;
const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };

/**
 * Imports an export from another leveling bot (Lacuna format: array of users with
 * activities.levels[] / activities.wallets[]). Only rows of the given guild are used.
 * The member's LEVEL is kept: XP is placed at the start of that level in this bot's curve
 * plus their progress inside the level. Existing values are never lowered.
 */
async function importLacuna(guildId, users) {
  if (!Array.isArray(users)) throw new Error('Ожидался массив пользователей');
  let imported = 0;
  let skipped = 0;

  for (const user of users) {
    const userId = String(user?._id || '');
    const row = user?.activities?.levels?.find((l) => String(l.guild_id) === String(guildId));
    if (!/^\d{15,25}$/.test(userId) || !row) {
      skipped++;
      continue;
    }
    const level = Math.max(0, Math.min(500, Math.trunc(Number(row.experience?.level) || 0)));
    const progress = num(row.experience?.current, MAX_XP_PART);
    const xp = Math.round(totalXpForLevel(level) + Math.min(progress, xpForLevel(level) - 1));
    const wallet = user.activities?.wallets?.find((w) => String(w.guild_id) === String(guildId));
    const money = num(wallet?.currencies?.find((c) => c.id === 'DEFAULT')?.amount, MAX_MONEY);
    const messages = num(row.activity?.total_messages, MAX_COUNT);
    const voice = num(row.activity?.total_voice_time, MAX_COUNT);

    const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
    const dark = user.dark && typeof user.dark === 'object' ? user.dark : null;
    if (dark) {
      // Export of this bot: both directions are restored exactly (never lowered).
      profile.chatXp = Math.max(Number(profile.chatXp), num(dark.chatXp, MAX_XP_PART));
      profile.voiceXp = Math.max(Number(profile.voiceXp), num(dark.voiceXp, MAX_XP_PART));
      profile.crystals = Math.max(Number(profile.crystals), num(dark.crystals, MAX_MONEY));
    } else if (xp > Number(profile.xp)) {
      // Other bots keep one XP number: it cannot be split, so it counts as chat progress.
      profile.chatXp = Number(profile.chatXp) + (xp - Number(profile.xp));
    }
    profile.xp = Number(profile.chatXp) + Number(profile.voiceXp);
    profile.level = levelFromXp(profile.xp);
    profile.balance = Math.max(Number(profile.balance), money);
    profile.messageCount = Math.max(Number(profile.messageCount), messages);
    profile.voiceSeconds = Math.max(Number(profile.voiceSeconds || 0), voice);
    await profile.save();
    imported++;
  }
  return { imported, skipped };
}

module.exports = { importLacuna };
