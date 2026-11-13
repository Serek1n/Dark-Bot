// /pay with the economy's sections: the treasury's tax, the daily limit, transfers to newcomers held for a while, and a mark on
// transfers from newcomers (many new accounts sending to one person is how alt accounts are milked — the panel lists such chains).
const { Op, QueryTypes } = require('sequelize');
const { sequelize, inTransaction, EconomyHold, MemberProfile } = require('../../../db');
const config = require('./config');
const ledger = require('./ledger');
const wallet = require('../wallet');

const HOUR = 3600000; const DAY = 86400000;

/** Is a member a newcomer by the protection's rules (too few days on the server, or a level too low)? */
function isNewbie(member, level, p) {
  const joined = member?.joinedTimestamp || (member?.joinedAt ? new Date(member.joinedAt).getTime() : null);
  const days = joined ? (Date.now() - joined) / DAY : Infinity;
  return (p.newbieDays > 0 && days < p.newbieDays) || (p.newbieLevel > 0 && Number(level || 0) < p.newbieLevel);
}

/** Coins a member has sent today (UTC day), by /pay and gift codes. */
async function sentToday(guildId, userId) {
  const rows = await sequelize.query("SELECT COALESCE(-SUM(amount), 0) AS s FROM economy_tx WHERE guildId = ? AND userId = ? AND currency = 'coins' AND kind IN ('pay_out', 'hold_out', 'gift_out') AND createdAt >= ?",
    { replacements: [guildId, userId, new Date(`${ledger.day()}T00:00:00Z`)], type: QueryTypes.SELECT });
  return Number(rows[0]?.s || 0);
}

/**
 * Pays from one member to another with every rule of the server. Returns one of
 *   { ok: true, received, tax }                       — delivered now;
 *   { ok: true, held: true, releaseAt, received, tax } — the receiver is new: it arrives later;
 *   { ok: false, reason: 'funds' | 'limit', left }.
 */
async function pay(settings, guildId, sender, receiver, field, amount) {
  const coins = field === 'balance';
  const protect = config.isOn(settings, 'protect') ? config.params(settings, 'protect') : null;
  const tax = coins && config.isOn(settings, 'treasury') ? ledger.percent(amount, config.params(settings, 'treasury').payTax) : 0;
  if (protect && coins && protect.payDailyLimit > 0) {
    const sent = await sentToday(guildId, sender.id);
    if (sent + amount > protect.payDailyLimit) return { ok: false, reason: 'limit', left: Math.max(0, protect.payDailyLimit - sent), limit: protect.payDailyLimit };
  }
  let flag = null; let hold = false;
  if (protect) {
    const levels = await MemberProfile.findAll({ where: { guildId, userId: [sender.id, receiver.id] }, attributes: ['userId', 'level'], raw: true });
    const lvl = (id) => levels.find((r) => r.userId === id)?.level || 0;
    if (isNewbie(sender, lvl(sender.id), protect)) flag = 'newbie';
    hold = isNewbie(receiver, lvl(receiver.id), protect);
  }
  if (!hold) {
    const r = await ledger.move(guildId, sender.id, receiver.id, field, amount, { tax, flag });
    return r.ok ? { ok: true, received: r.received, tax: r.tax } : { ok: false, reason: 'funds' };
  }
  const releaseAt = new Date(Date.now() + protect.holdHours * HOUR);
  const received = amount - tax;
  const done = await inTransaction(async (t) => {
    if ((await wallet.spend(guildId, sender.id, field, amount, t)) === null) return false;
    if (tax > 0) await ledger.treasuryAdd(guildId, tax, t);
    await ledger.record({ guildId, userId: sender.id, currency: ledger.currencyOf(field), amount: -amount, kind: 'hold_out', otherId: receiver.id, flag, note: tax ? `tax:${tax}` : null }, t);
    await EconomyHold.create({ guildId, fromId: sender.id, toId: receiver.id, currency: ledger.currencyOf(field), amount: received, releaseAt, status: 'held' }, { transaction: t });
    return true;
  });
  if (!done) return { ok: false, reason: 'funds' };
  require('../../utils/scheduler').poke?.('economy');
  return { ok: true, held: true, releaseAt, received, tax };
}

/** Delivers the held transfers whose time has come. Returns how many. */
async function releaseDue(now = new Date()) {
  const due = await EconomyHold.findAll({ where: { status: 'held', releaseAt: { [Op.lte]: now } }, limit: 200 });
  let n = 0;
  for (const h of due) {
    const ok = await inTransaction(async (t) => {
      const [changed] = await EconomyHold.update({ status: 'released' }, { where: { id: h.id, status: 'held' }, transaction: t });
      if (!changed) return false;
      await wallet.credit(h.guildId, h.toId, ledger.fieldOf(h.currency), h.amount, t);
      await ledger.record({ guildId: h.guildId, userId: h.toId, currency: h.currency, amount: h.amount, kind: 'hold_in', otherId: h.fromId }, t);
      return true;
    });
    if (ok) n++;
  }
  return n;
}

/** An admin sends a held transfer back to its sender (panel). */
async function returnHold(guildId, id) {
  return inTransaction(async (t) => {
    const h = await EconomyHold.findOne({ where: { id, guildId, status: 'held' }, transaction: t });
    if (!h) return false;
    await h.update({ status: 'returned' }, { transaction: t });
    await wallet.credit(guildId, h.fromId, ledger.fieldOf(h.currency), h.amount, t);
    await ledger.record({ guildId, userId: h.fromId, currency: h.currency, amount: h.amount, kind: 'hold_back', otherId: h.toId }, t);
    return true;
  });
}

/**
 * Suspicious chains: members who, in the last `days` days, got transfers from at least `min` different newcomers.
 * [{ userId, senders, total }]
 */
async function suspicious(guildId, { days = 7, min = 3 } = {}) {
  const rows = await sequelize.query(`SELECT otherId AS userId, COUNT(DISTINCT userId) AS senders, -SUM(amount) AS total FROM economy_tx
    WHERE guildId = ? AND flag = 'newbie' AND kind IN ('pay_out', 'hold_out') AND createdAt >= ? GROUP BY otherId HAVING COUNT(DISTINCT userId) >= ? ORDER BY senders DESC LIMIT 20`,
  { replacements: [guildId, new Date(Date.now() - days * DAY), min], type: QueryTypes.SELECT });
  return rows.map((r) => ({ userId: r.userId, senders: Number(r.senders), total: Number(r.total) }));
}

module.exports = { pay, isNewbie, sentToday, releaseDue, returnHold, suspicious };
