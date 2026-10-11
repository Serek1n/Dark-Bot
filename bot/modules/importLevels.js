const { MemberProfile } = require('../../db');
const { xpForLevel, totalXpForLevel, levelFromXp } = require('./leveling');

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
    const progress = Math.max(0, Number(row.experience?.current) || 0);
    const xp = Math.round(totalXpForLevel(level) + Math.min(progress, xpForLevel(level) - 1));
    const wallet = user.activities?.wallets?.find((w) => String(w.guild_id) === String(guildId));
    const money = Math.round(Number(wallet?.currencies?.find((c) => c.id === 'DEFAULT')?.amount) || 0);
    const messages = Math.max(0, Math.trunc(Number(row.activity?.total_messages) || 0));
    const voice = Math.max(0, Math.trunc(Number(row.activity?.total_voice_time) || 0));

    const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
    profile.xp = Math.max(Number(profile.xp), xp);
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
