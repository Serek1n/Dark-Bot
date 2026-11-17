// DARK Coins — the platform's own currency, only for its paid features (promotion of communities). Separate from every
// server's coins and crystals: not exchanged, not earned by commands, not touched by server admins or economy settings.
//
// The ONLY ways a balance changes are here:
//   grant / revoke — by a platform owner (BOT_OWNER_IDS), checked inside, not only on the page;
//   charge         — a purchase on the platform (promotion), made by the code of the purchase itself.
// Each change is one transaction: the wallet is changed by an additive statement that refuses to go below zero, and a line
// with a unique operation key goes into dark_coin_tx. The same key again (a double click, a repeated form, a retry) does
// nothing and returns the first result. No real payments are connected.
const { Op } = require('sequelize');

class CoinError extends Error {}
const db = () => require('../../db');
const MAX_GRANT = 10_000_000;
const owners = () => (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const isPlatformOwner = (userId) => Boolean(userId) && owners().includes(String(userId));
const snow = (v) => /^\d{15,25}$/.test(String(v || ''));
const KEY_RE = /^[\w:.-]{8,80}$/;

async function balanceOf(userId) {
  const w = await db().DarkWallet.findOne({ where: { userId: String(userId) } });
  return Number(w?.balance || 0);
}

async function history(userId, limit = 30) {
  return db().DarkCoinTx.findAll({ where: userId ? { userId: String(userId) } : {}, order: [['id', 'DESC']], limit });
}

/**
 * Changes a wallet by `delta` (± whole coins) and writes the journal line. Inside a transaction `t` when given (a purchase
 * that also writes its promotion), else in its own. Returns { tx, duplicate }.
 */
async function move(userId, delta, { kind, opKey, actorId = null, note = null }, t = null) {
  const { DarkWallet, DarkCoinTx, sequelize, inTransaction } = db();
  const d = Math.trunc(Number(delta));
  if (!snow(userId)) throw new CoinError('Неверный ID пользователя.');
  if (!Number.isSafeInteger(d) || d === 0) throw new CoinError('Сумма должна быть целым числом, не нулём.');
  if (!KEY_RE.test(String(opKey || ''))) throw new CoinError('Нет ключа операции.');
  const run = async (tr) => {
    const seen = await DarkCoinTx.findOne({ where: { opKey }, transaction: tr });
    if (seen) return { tx: seen, duplicate: true };
    await DarkWallet.findOrCreate({ where: { userId: String(userId) }, defaults: { balance: 0 }, transaction: tr });
    const [changed] = await DarkWallet.update({ balance: sequelize.literal(`balance + (${d})`) }, { where: { userId: String(userId), balance: { [Op.gte]: Math.max(0, -d) } }, transaction: tr });
    if (!changed) throw new CoinError('Недостаточно DARK Coins.');
    const w = await DarkWallet.findOne({ where: { userId: String(userId) }, transaction: tr });
    const tx = await DarkCoinTx.create({ userId: String(userId), amount: d, balanceAfter: Number(w.balance), kind, opKey, actorId, note: note ? String(note).slice(0, 200) : null }, { transaction: tr });
    return { tx, duplicate: false };
  };
  try {
    return t ? await run(t) : await inTransaction(run);
  } catch (err) {
    // the same key written at the same moment by another request: that one won, this one is the duplicate
    if (/UNIQUE/i.test(String(err?.message)) || err?.name === 'SequelizeUniqueConstraintError') {
      const seen = await DarkCoinTx.findOne({ where: { opKey } });
      if (seen) return { tx: seen, duplicate: true };
    }
    throw err;
  }
}

/** A platform owner gives coins (no payment is involved). */
async function grant({ actorId, userId, amount, note, opKey }) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Начислять DARK Coins может только владелец платформы.');
  const n = Math.trunc(Number(amount));
  if (!(n > 0 && n <= MAX_GRANT)) throw new CoinError(`Сумма — от 1 до ${MAX_GRANT}.`);
  return move(userId, n, { kind: 'grant', opKey: `grant:${opKey}`, actorId, note });
}

/** A platform owner takes coins back (never below zero). */
async function revoke({ actorId, userId, amount, note, opKey }) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Списывать DARK Coins может только владелец платформы.');
  const n = Math.trunc(Number(amount));
  if (!(n > 0 && n <= MAX_GRANT)) throw new CoinError(`Сумма — от 1 до ${MAX_GRANT}.`);
  return move(userId, -n, { kind: 'revoke', opKey: `revoke:${opKey}`, actorId, note });
}

/** A purchase on the platform: takes `amount` from the buyer inside the purchase's transaction. */
function charge(userId, amount, { kind, opKey, note }, t) {
  const n = Math.trunc(Number(amount));
  if (!(n > 0)) throw new CoinError('Цена должна быть больше нуля.');
  return move(userId, -n, { kind, opKey, actorId: userId, note }, t);
}

/** A fresh key for a form (put into a hidden field: sending the same form twice is one operation). */
const newKey = () => require('crypto').randomBytes(12).toString('hex');

module.exports = { CoinError, isPlatformOwner, balanceOf, history, grant, revoke, charge, newKey, MAX_GRANT };
