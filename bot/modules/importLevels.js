const { MemberProfile, sequelize } = require('../../db');
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

    await MemberProfile.findOrCreate({ where: { guildId, userId } });
    const dark = user.dark && typeof user.dark === 'object' ? user.dark : null;
    // ONE statement per member, in SQL ("the bigger of the two"), never read-change-write: the bot keeps adding XP and
    // coins while an import runs, and a saved copy of the row would silently undo what was earned in between.
    const common = 'balance = MAX(balance, :money), messageCount = MAX(messageCount, :messages), voiceSeconds = MAX(COALESCE(voiceSeconds, 0), :voice), updatedAt = CURRENT_TIMESTAMP';
    const where = 'WHERE guildId = :guildId AND userId = :userId';
    const replacements = { guildId, userId, money, messages, voice, xp, chat: dark ? num(dark.chatXp, MAX_XP_PART) : 0, voiceXp: dark ? num(dark.voiceXp, MAX_XP_PART) : 0, crystals: dark ? num(dark.crystals, MAX_MONEY) : 0 };
    if (dark) {
      // Export of this bot: both directions are restored exactly (never lowered).
      await sequelize.query(`UPDATE member_profiles SET chatXp = MAX(chatXp, :chat), voiceXp = MAX(voiceXp, :voiceXp), xp = MAX(chatXp, :chat) + MAX(voiceXp, :voiceXp), crystals = MAX(crystals, :crystals), ${common} ${where}`, { replacements });
    } else {
      // Other bots keep one XP number: it cannot be split, so what is missing counts as chat progress.
      await sequelize.query(`UPDATE member_profiles SET chatXp = chatXp + MAX(0, :xp - xp), xp = MAX(xp, :xp), ${common} ${where}`, { replacements });
    }
    const row2 = await MemberProfile.findOne({ where: { guildId, userId }, attributes: ['xp'], raw: true });
    if (row2) await sequelize.query(`UPDATE member_profiles SET level = :level ${where} AND xp = :was`, { replacements: { guildId, userId, level: levelFromXp(Number(row2.xp)), was: row2.xp } });
    imported++;
  }
  return { imported, skipped };
}

module.exports = { importLacuna };
