// Bets in the mini-games (/coinflip, /rps): with «Мини-игры» → «Ставки» on, a member plays for the server's coins. The
// bet is taken first; a win pays it back with the server's coefficient, minus the tax that goes to the treasury. The
// winnings of one day are capped (the net result of the day's bets and wins). Settings: funConfig (moduleConfig.js).
const { QueryTypes } = require('sequelize');
const { sequelize, inTransaction } = require('../../db');
const ledger = require('./econ/ledger');

/** Today's net result of a member's bets (wins minus stakes), from the journal. */
async function todayProfit(guildId, userId, now = new Date()) {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const rows = await sequelize.query("SELECT COALESCE(SUM(amount), 0) AS n FROM economy_tx WHERE guildId = ? AND userId = ? AND kind IN ('fun_bet', 'fun_win') AND createdAt >= ?",
    { replacements: [guildId, userId, start], type: QueryTypes.SELECT });
  return Number(rows[0]?.n || 0);
}

/** Why this bet cannot be made, or null. economyOn: the economy module is on. */
async function refusal(guildId, userId, cfg, bet, economyOn = true) {
  if (!cfg.bets || !economyOn) return 'Ставки в мини-играх на этом сервере выключены.';
  if (!Number.isInteger(bet) || bet < cfg.betMin) return `Ставка — не меньше ${cfg.betMin}.`;
  if (bet > cfg.betMax) return `Ставка — не больше ${cfg.betMax}.`;
  if (cfg.dailyWinCap && (await todayProfit(guildId, userId)) >= cfg.dailyWinCap) return `На сегодня вы выиграли предел сервера (${cfg.dailyWinCap}). Возвращайтесь завтра.`;
  return null;
}

/**
 * Plays a bet: takes it, and on a win pays bet × payout% back minus the tax on the profit (to the treasury).
 * result: 'win' | 'lose' | 'draw' (a draw gives the bet back). Returns { ok, paid, tax, balance } or { ok: false } when
 * the member has too little.
 */
async function settle(guildId, userId, cfg, bet, result, game) {
  return inTransaction(async (t) => {
    const after = await ledger.take(guildId, userId, 'balance', bet, 'fun_bet', { note: game }, t);
    if (after === null) return { ok: false };
    if (result === 'lose') return { ok: true, paid: 0, tax: 0, balance: after };
    const payout = result === 'draw' ? bet : Math.floor((bet * (game === 'rps' ? cfg.rpsPayout : cfg.coinflipPayout)) / 100);
    const profit = Math.max(0, payout - bet);
    const tax = result === 'draw' ? 0 : Math.floor((profit * cfg.taxPct) / 100);
    const balance = await ledger.give(guildId, userId, 'balance', payout - tax, 'fun_win', { note: game }, t);
    if (tax) await ledger.treasuryAdd(guildId, tax, t);
    return { ok: true, paid: payout - tax, tax, balance };
  });
}

module.exports = { todayProfit, refusal, settle };
