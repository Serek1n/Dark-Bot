// Подарочные коды: a member turns part of his balance into a one-time code (/gift create) that anyone on the server can redeem
// (/gift redeem). An admin can issue a batch of codes from the panel — paid by the treasury, or as new money for a contest.
const crypto = require('crypto');
const { Op, QueryTypes } = require('sequelize');
const { sequelize, inTransaction, EconomyGift } = require('../../../db');
const ledger = require('./ledger');
const wallet = require('../wallet');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to read aloud and type
const makeCode = () => `DARK-${Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}-${Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}`;
const normalize = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

async function createdToday(guildId, userId) {
  return EconomyGift.count({ where: { guildId, creatorId: userId, createdAt: { [Op.gte]: new Date(`${ledger.day()}T00:00:00Z`) } } });
}

/** A member's code, paid from his balance. Returns { code } or { error: 'funds' | 'limit' | 'min' }. */
async function create(guildId, userId, amount, p) {
  if (amount < p.minAmount) return { error: 'min' };
  if ((await createdToday(guildId, userId)) >= p.maxPerDay) return { error: 'limit' };
  return inTransaction(async (t) => {
    if ((await wallet.spend(guildId, userId, 'balance', amount, t)) === null) return { error: 'funds' };
    let code; for (let i = 0; i < 5; i++) { code = makeCode(); if (!(await EconomyGift.findOne({ where: { guildId, code }, transaction: t }))) break; }
    await EconomyGift.create({ guildId, code, amount, creatorId: userId }, { transaction: t });
    await ledger.record({ guildId, userId, amount: -amount, kind: 'gift_out', note: code }, t);
    return { code };
  });
}

/** An admin's batch. source: 'treasury' (the whole batch must fit in it) | 'mint' (new money). Returns { codes } or { error }. */
async function createBatch(guildId, { count, amount, source }) {
  const batch = `B${Date.now().toString(36).toUpperCase()}`;
  return inTransaction(async (t) => {
    if (source === 'treasury' && !(await ledger.treasuryTake(guildId, count * amount, t))) return { error: 'treasury' };
    const codes = [];
    for (let i = 0; i < count; i++) {
      let code; for (let k = 0; k < 5; k++) { code = makeCode(); if (!codes.includes(code) && !(await EconomyGift.findOne({ where: { guildId, code }, transaction: t }))) break; }
      codes.push(code);
    }
    await EconomyGift.bulkCreate(codes.map((code) => ({ guildId, code, amount, creatorId: null, batch: `${batch}:${source}` })), { transaction: t });
    return { codes, batch };
  });
}

/** Redeems a code once. Returns { amount, creatorId } or { error: 'unknown' | 'used' | 'own' }. */
async function redeem(guildId, userId, rawCode) {
  const code = normalize(rawCode);
  return inTransaction(async (t) => {
    const gift = await EconomyGift.findOne({ where: { guildId, code }, transaction: t });
    if (!gift) return { error: 'unknown' };
    if (gift.redeemedBy) return { error: 'used' };
    if (gift.creatorId === userId) return { error: 'own' };
    const [changed] = await EconomyGift.update({ redeemedBy: userId, redeemedAt: new Date() }, { where: { id: gift.id, redeemedBy: null }, transaction: t });
    if (!changed) return { error: 'used' };
    await wallet.credit(guildId, userId, 'balance', gift.amount, t);
    await ledger.record({ guildId, userId, amount: gift.amount, kind: gift.creatorId ? 'gift_in' : 'admin', otherId: gift.creatorId, note: code }, t);
    return { amount: gift.amount, creatorId: gift.creatorId };
  });
}

/** An unused admin code is withdrawn (its treasury money goes back to the treasury). */
async function revoke(guildId, id) {
  return inTransaction(async (t) => {
    const gift = await EconomyGift.findOne({ where: { id, guildId, redeemedBy: null }, transaction: t });
    if (!gift || gift.creatorId) return false;
    await gift.destroy({ transaction: t });
    if (String(gift.batch || '').endsWith(':treasury')) await ledger.treasuryAdd(guildId, gift.amount, t);
    return true;
  });
}

async function list(guildId, { limit = 100 } = {}) {
  return sequelize.query('SELECT id, code, amount, creatorId, batch, redeemedBy, redeemedAt, createdAt FROM economy_gifts WHERE guildId = ? AND creatorId IS NULL ORDER BY id DESC LIMIT ?',
    { replacements: [guildId, limit], type: QueryTypes.SELECT });
}

module.exports = { create, createBatch, redeem, revoke, list, normalize, makeCode };
