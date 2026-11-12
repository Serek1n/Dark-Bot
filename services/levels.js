// Changing a member's level by hand: the same for /level in Discord and "Изменить уровень участника" in the panel.
const { MemberProfile } = require('../db');
const { computeLevelAdjust } = require('../bot/modules/leveling');

/**
 * Changes the level in the database without losing experience the bot adds at the same moment: the row is written only
 * if nobody changed it since it was read, otherwise it is read again (up to 5 times). Returns the result or null.
 */
async function adjustLevel(guildId, userId, mode, amount) {
  await MemberProfile.findOrCreate({ where: { guildId, userId } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await MemberProfile.findOne({ where: { guildId, userId } });
    const next = computeLevelAdjust(p, mode, amount);
    const [changed] = await MemberProfile.update(
      { xp: next.xp, level: next.level, chatXp: next.chatXp, voiceXp: next.voiceXp },
      { where: { guildId, userId, xp: p.xp, chatXp: p.chatXp, voiceXp: p.voiceXp } }
    );
    if (changed) return next;
  }
  return null;
}

module.exports = { adjustLevel };
