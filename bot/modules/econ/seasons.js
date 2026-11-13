// Сезоны: every N months the coins start from zero. The richest N of the season get a badge for good ("Сезон 3 · #1", shown on the
// profile card); crystals and roles stay. The season's end is announced with the winners.
const { Op } = require('sequelize');
const { sequelize, inTransaction, GuildSettings, EconomyBadge, MemberProfile } = require('../../../db');
const embeds = require('../../utils/embeds');
const config = require('./config');
const events = require('./events');

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
function addMonths(d, n) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

/** When the current season ends (null when seasons are off). */
function endOf(settings) {
  if (!config.isOn(settings, 'seasons')) return null;
  const start = settings.seasonStartedAt ? new Date(settings.seasonStartedAt) : null;
  if (!start) return null;
  return addMonths(start, config.params(settings, 'seasons').months);
}

/** A server that has just switched seasons on starts its first season now. */
async function ensureStarted(settings) {
  if (config.isOn(settings, 'seasons') && !settings.seasonStartedAt) {
    await GuildSettings.update({ seasonStartedAt: new Date() }, { where: { guildId: settings.guildId } });
    settings.seasonStartedAt = new Date();
  }
}

/** Ends the season now: badges to the top, coins to zero (written in the journal), the next season begins. Returns the winners. */
async function endSeason(settings) {
  const guildId = settings.guildId;
  const number = Number(settings.seasonNumber) || 1;
  const top = config.params(settings, 'seasons').top;
  const winners = await inTransaction(async (t) => {
    const rows = await MemberProfile.findAll({ where: { guildId, balance: { [Op.gt]: 0 } }, order: [['balance', 'DESC'], ['id', 'ASC']], limit: top, attributes: ['userId', 'balance'], raw: true, transaction: t });
    if (rows.length) await EconomyBadge.bulkCreate(rows.map((r, i) => ({ guildId, userId: r.userId, season: number, place: i + 1, amount: Number(r.balance) })), { transaction: t });
    const now = new Date();
    await sequelize.query(`INSERT INTO economy_tx (guildId, userId, currency, amount, kind, note, createdAt)
      SELECT guildId, userId, 'coins', -balance, 'season', ?, ? FROM member_profiles WHERE guildId = ? AND balance > 0`, { replacements: [`Сезон ${number}`, now, guildId], transaction: t });
    await sequelize.query('UPDATE member_profiles SET balance = 0, updatedAt = ? WHERE guildId = ? AND balance > 0', { replacements: [now, guildId], transaction: t });
    await sequelize.query('UPDATE guild_settings SET seasonNumber = ?, seasonStartedAt = ? WHERE guildId = ?', { replacements: [number + 1, now, guildId], transaction: t });
    return rows;
  });
  settings.seasonNumber = number + 1; settings.seasonStartedAt = new Date();
  GuildSettings.update({ updatedAt: new Date() }, { where: { guildId } }).catch(() => {}); // clears the bot's settings cache
  const lines = winners.map((w, i) => `${i + 1}. <@${w.userId}> — ${fmt(w.balance)} ${settings.currencyName || 'монет'}`);
  await events.post(settings, embeds.baseEmbed(embeds.COLORS.success).setTitle(`Сезон ${number} завершён`)
    .setDescription(`${lines.length ? `Лучшие по богатству получают значок «Сезон ${number}» в профиль:\n${lines.join('\n')}\n\n` : ''}Монеты обнулились, кристаллы и роли остались. Начался сезон ${number + 1}!`), null, 'season_end');
  return winners;
}

/** Servers whose season is over. */
async function endDue(now = new Date()) {
  const rows = await GuildSettings.findAll({ where: { economyMode: { [Op.ne]: 'simple' }, seasonStartedAt: { [Op.ne]: null } } });
  let n = 0;
  for (const s of rows) { const end = endOf(s); if (end && end <= now) { await endSeason(s); n++; } }
  return n;
}

/** The soonest season end of all servers (for the scheduler). */
async function nextEnd() {
  const rows = await GuildSettings.findAll({ where: { economyMode: { [Op.ne]: 'simple' }, seasonStartedAt: { [Op.ne]: null } }, attributes: ['guildId', 'economyEnabled', 'economyMode', 'economyPreset', 'economyFeatures', 'economyParams', 'seasonStartedAt'] });
  let best = null;
  for (const s of rows) { const e = endOf(s); if (e && (!best || e < best)) best = e; }
  return best;
}

async function badgesOf(guildId, userId) {
  return EconomyBadge.findAll({ where: { guildId, userId }, order: [['place', 'ASC'], ['season', 'DESC']], limit: 5, raw: true });
}
/** The badge to show on a card: the best place, the newest season among equals. */
async function badgeText(guildId, userId) {
  const b = (await badgesOf(guildId, userId))[0];
  return b ? `Сезон ${b.season} · #${b.place}` : null;
}

module.exports = { endOf, ensureStarted, endSeason, endDue, nextEnd, badgesOf, badgeText };
