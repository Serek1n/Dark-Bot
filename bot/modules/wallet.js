// Coins and crystals are changed only by ONE SQL statement that adds or takes an amount ("balance = balance - 100 WHERE balance >= 100"),
// never by reading a profile, changing it in memory and saving the absolute number. The saved copy could be stale: a message's XP,
// /pay, /daily, the shop, the voice tick and the web panel (another process) all touch the same row, and the last one to save would
// erase what the others did. With additive statements every change survives, whatever the order, in this process or another.
const { QueryTypes } = require('sequelize');
const { sequelize, inTransaction } = require('../../db');

const FIELDS = new Set(['balance', 'crystals']);
const column = (f) => { if (!FIELDS.has(f)) throw new Error(`Unknown wallet column: ${f}`); return f; };
const amountOf = (n) => { const v = Number(n); if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Bad amount: ${n}`); return v; };

/** Makes sure the member has a row (nothing changes if there already is one). */
async function ensureProfile(guildId, userId, transaction) {
  const now = new Date();
  await sequelize.query('INSERT OR IGNORE INTO member_profiles (guildId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?)', { replacements: [guildId, userId, now, now], transaction });
}

/** Adds an amount; returns the balance after it. */
async function credit(guildId, userId, field, amount, transaction) {
  const f = column(field); const n = amountOf(amount);
  await ensureProfile(guildId, userId, transaction);
  const rows = await sequelize.query(`UPDATE member_profiles SET ${f} = ${f} + ?, updatedAt = ? WHERE guildId = ? AND userId = ? RETURNING ${f} AS value`,
    { replacements: [n, new Date(), guildId, userId], type: QueryTypes.SELECT, transaction });
  return Number(rows[0].value);
}

/** Takes an amount only if there is enough, in the same statement as the check. Returns the balance after, or null when there was not enough. */
async function spend(guildId, userId, field, amount, transaction) {
  const f = column(field); const n = amountOf(amount);
  const rows = await sequelize.query(`UPDATE member_profiles SET ${f} = ${f} - ?, updatedAt = ? WHERE guildId = ? AND userId = ? AND ${f} >= ? RETURNING ${f} AS value`,
    { replacements: [n, new Date(), guildId, userId, n], type: QueryTypes.SELECT, transaction });
  return rows.length ? Number(rows[0].value) : null;
}

/** Moves an amount from one member to another: both halves or neither. Returns true, or false when the sender has too little. */
async function transfer(guildId, fromId, toId, field, amount) {
  return inTransaction(async (transaction) => {
    if ((await spend(guildId, fromId, field, amount, transaction)) === null) return false;
    await credit(guildId, toId, field, amount, transaction);
    return true;
  });
}

module.exports = { ensureProfile, credit, spend, transfer };
