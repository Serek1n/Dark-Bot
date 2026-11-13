// The one way money moves once the journal exists: every change of a balance also writes what it was for. Balances are still changed
// only by additive statements (bot/modules/wallet.js), so nothing done at the same moment by another process is lost.
//   give / take        — one member, one amount, one line in the journal;
//   move               — from one member to another in one transaction, with the treasury's tax if the server has one;
//   earn / earnMany    — the steady income (chat, voice, levels): summed per member per day, one small statement;
//   treasuryAdd/Take   — the server's own coins.
const { QueryTypes } = require('sequelize');
const { sequelize, inTransaction } = require('../../../db');
const wallet = require('../wallet');

const CURRENCY = { balance: 'coins', crystals: 'crystals' };
const FIELD = { coins: 'balance', crystals: 'crystals' };
const currencyOf = (field) => CURRENCY[field] || (FIELD[field] ? field : 'coins');
const fieldOf = (currency) => FIELD[currency] || (CURRENCY[currency] ? currency : 'balance');
const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

/** Writes journal lines: [{ guildId, userId, currency, amount, kind, otherId?, note?, flag? }]. */
async function record(rows, transaction) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r && Number(r.amount));
  if (!list.length) return;
  const now = new Date();
  await sequelize.query(
    `INSERT INTO economy_tx (guildId, userId, currency, amount, kind, otherId, note, flag, createdAt) VALUES ${list.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}`,
    { replacements: list.flatMap((r) => [r.guildId, r.userId, r.currency || 'coins', Math.trunc(r.amount), r.kind, r.otherId || null, r.note ? String(r.note).slice(0, 200) : null, r.flag || null, r.at || now]), transaction }
  );
}

/** Steady income of many members at once: one additive statement. */
async function earnMany(guildId, userIds, kind, currency, amount, transaction) {
  const n = Math.trunc(Number(amount) || 0);
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!n || !ids.length) return;
  const d = day();
  await sequelize.query(
    `INSERT INTO economy_earn (guildId, userId, day, kind, currency, amount) VALUES ${ids.map(() => '(?, ?, ?, ?, ?, ?)').join(',')}
     ON CONFLICT (guildId, userId, day, kind, currency) DO UPDATE SET amount = economy_earn.amount + excluded.amount`,
    { replacements: ids.flatMap((id) => [guildId, id, d, kind, currency, n]), transaction }
  );
}
const earn = (guildId, userId, kind, currency, amount, transaction) => earnMany(guildId, [userId], kind, currency, amount, transaction);

/** Adds an amount to a member and writes why. Returns the balance after. */
async function give(guildId, userId, field, amount, kind, meta = {}, transaction) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return null;
  const run = async (t) => {
    const after = await wallet.credit(guildId, userId, field, n, t);
    await record({ guildId, userId, currency: currencyOf(field), amount: n, kind, ...meta }, t);
    return after;
  };
  return transaction ? run(transaction) : inTransaction(run);
}

/** Takes an amount only if the member has it, and writes why. Returns the balance after, or null when there was not enough. */
async function take(guildId, userId, field, amount, kind, meta = {}, transaction) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return null;
  const run = async (t) => {
    const after = await wallet.spend(guildId, userId, field, n, t);
    if (after === null) return null;
    await record({ guildId, userId, currency: currencyOf(field), amount: -n, kind, ...meta }, t);
    return after;
  };
  return transaction ? run(transaction) : inTransaction(run);
}

/** The server's treasury (coins). */
async function treasuryAdd(guildId, amount, transaction) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return;
  await sequelize.query('UPDATE guild_settings SET treasury = COALESCE(treasury, 0) + ? WHERE guildId = ?', { replacements: [n, guildId], transaction });
}
async function treasuryTake(guildId, amount, transaction) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return false;
  const rows = await sequelize.query('UPDATE guild_settings SET treasury = treasury - ? WHERE guildId = ? AND treasury >= ? RETURNING treasury', { replacements: [n, guildId, n], type: QueryTypes.SELECT, transaction });
  return rows.length > 0;
}
async function treasuryOf(guildId) {
  const rows = await sequelize.query('SELECT treasury FROM guild_settings WHERE guildId = ?', { replacements: [guildId], type: QueryTypes.SELECT });
  return Number(rows[0]?.treasury || 0);
}

/**
 * From one member to another, all or nothing. `tax` (coins only) is kept back from what the receiver gets and goes to the treasury.
 * Returns { ok, received, tax } or { ok: false } when the sender has too little.
 */
async function move(guildId, fromId, toId, field, amount, { kindOut = 'pay_out', kindIn = 'pay_in', tax = 0, flag = null, note = null } = {}) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return { ok: false };
  const t = field === 'balance' ? Math.min(n, Math.max(0, Math.trunc(tax))) : 0;
  return inTransaction(async (transaction) => {
    if ((await wallet.spend(guildId, fromId, field, n, transaction)) === null) return { ok: false };
    const received = n - t;
    if (received > 0) await wallet.credit(guildId, toId, field, received, transaction);
    if (t > 0) await treasuryAdd(guildId, t, transaction);
    const currency = currencyOf(field);
    await record([
      { guildId, userId: fromId, currency, amount: -n, kind: kindOut, otherId: toId, note, flag },
      { guildId, userId: toId, currency, amount: received, kind: kindIn, otherId: fromId, note: t > 0 ? `tax:${t}` : note, flag }
    ], transaction);
    return { ok: true, received, tax: t };
  });
}

/** Percent of an amount, rounded down, never more than the amount. */
const percent = (amount, pct) => Math.min(amount, Math.floor((Math.trunc(amount) * Math.max(0, Number(pct) || 0)) / 100));

/** A member's operations, newest first: journal lines and the daily sums of chat, voice and levels, mixed. */
async function history(guildId, userId, { limit = 15, sinceDays = 60 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000);
  const [tx, earned] = await Promise.all([
    sequelize.query('SELECT currency, amount, kind, otherId, note, createdAt FROM economy_tx WHERE guildId = ? AND userId = ? AND createdAt >= ? AND amount != 0 ORDER BY createdAt DESC, id DESC LIMIT ?',
      { replacements: [guildId, userId, since, limit], type: QueryTypes.SELECT }),
    sequelize.query('SELECT currency, amount, kind, day FROM economy_earn WHERE guildId = ? AND userId = ? AND day >= ? ORDER BY day DESC LIMIT ?',
      { replacements: [guildId, userId, day(since), limit], type: QueryTypes.SELECT })
  ]);
  const rows = [
    ...tx.map((r) => ({ ...r, amount: Number(r.amount), at: new Date(r.createdAt) })),
    ...earned.map((r) => ({ currency: r.currency, amount: Number(r.amount), kind: r.kind, at: new Date(`${r.day}T23:59:59Z`), daily: true, day: r.day }))
  ];
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Coins that came in (+) or went out (−) per day for a member, for the balance chart: { 'YYYY-MM-DD': delta }. */
async function dailyDeltas(guildId, userId, days = 30) {
  const since = day(new Date(Date.now() - days * 86400000));
  const [tx, earned] = await Promise.all([
    sequelize.query("SELECT substr(createdAt, 1, 10) AS d, SUM(amount) AS s FROM economy_tx WHERE guildId = ? AND userId = ? AND currency = 'coins' AND createdAt >= ? GROUP BY d",
      { replacements: [guildId, userId, since], type: QueryTypes.SELECT }),
    sequelize.query("SELECT day AS d, SUM(amount) AS s FROM economy_earn WHERE guildId = ? AND userId = ? AND currency = 'coins' AND day >= ? GROUP BY day",
      { replacements: [guildId, userId, since], type: QueryTypes.SELECT })
  ]);
  const out = {};
  for (const r of [...tx, ...earned]) out[r.d] = (out[r.d] || 0) + Number(r.s || 0);
  return out;
}

/** What each kind of operation is called for people. */
const KIND_LABELS = {
  chat: 'Чат', voice: 'Голос', level: 'Новый уровень', daily: 'Ежедневная награда', work: 'Работа',
  pay_in: 'Перевод от участника', pay_out: 'Перевод участнику', hold_out: 'Перевод новичку (с задержкой)', hold_in: 'Перевод пришёл', hold_back: 'Перевод вернулся',
  shop: 'Магазин', refund: 'Возврат за покупку', giveaway: 'Розыгрыш', admin: 'Администратор', treasury: 'Из казны',
  goal: 'Вклад в общую цель', goal_refund: 'Возврат из общей цели', deal_hold: 'Сделка: деньги заморожены', deal_in: 'Сделка: оплата', deal_refund: 'Сделка: возврат',
  gift_out: 'Подарочный код', gift_in: 'Подарок по коду', season: 'Конец сезона'
};
const kindLabel = (k) => KIND_LABELS[k] || k;

module.exports = { KIND_LABELS, kindLabel, record, earn, earnMany, give, take, move, treasuryAdd, treasuryTake, treasuryOf, history, dailyDeltas, percent, day, currencyOf, fieldOf };
