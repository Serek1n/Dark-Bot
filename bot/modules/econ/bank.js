// Центробанк: how much money a server has, where it comes from and goes to, how unevenly it is held, and — if the admin set an
// inflation target — a gentle automatic correction of the coin rewards (chat, voice, /daily). Once a day per server a snapshot of
// the money supply is written; the rate moves at most ±10% a day, so members never feel a jump.
const { QueryTypes } = require('sequelize');
const { sequelize, EconomySupply } = require('../../../db');
const config = require('./config');
const { day } = require('./ledger');

/** The multiplier of coin rewards right now (1 when the central bank is off). */
function rateOf(settings) {
  if (!settings || !config.isOn(settings, 'bank')) return 1;
  const p = config.params(settings, 'bank');
  const r = Number(settings.econRate);
  return Math.min(1, Math.max(p.minRate / 100, Number.isFinite(r) && r > 0 ? r : 1));
}

async function totals(guildId) {
  const rows = await sequelize.query('SELECT COALESCE(SUM(balance), 0) AS coins, COALESCE(SUM(crystals), 0) AS crystals, SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS holders FROM member_profiles WHERE guildId = ?',
    { replacements: [guildId], type: QueryTypes.SELECT });
  return { coins: Number(rows[0].coins || 0), crystals: Number(rows[0].crystals || 0), holders: Number(rows[0].holders || 0) };
}

/** Growth of the coin supply over the last 7 days, in percent (null while there is no week-old snapshot). */
async function weeklyInflation(guildId, now = new Date()) {
  const today = await EconomySupply.findOne({ where: { guildId, day: day(now) } });
  const weekAgo = await EconomySupply.findOne({ where: { guildId, day: { [require('sequelize').Op.lte]: day(new Date(now.getTime() - 7 * 86400000)) } }, order: [['day', 'DESC']] });
  if (!today || !weekAgo || !weekAgo.coins) return null;
  return ((today.coins - weekAgo.coins) / weekAgo.coins) * 100;
}

/**
 * The daily step for one server: writes today's snapshot (once) and, with the central bank on and its auto mode, moves the rate:
 * money grew faster than the target → rewards 10% smaller; much slower (under half the target) → 5% bigger, never above normal.
 * Returns { snapshot, inflation, rate, changed } or null when today was already done.
 */
async function dailyStep(settings, now = new Date()) {
  const guildId = settings.guildId;
  const d = day(now);
  if (await EconomySupply.findOne({ where: { guildId, day: d } })) return null;
  const t = await totals(guildId);
  await EconomySupply.create({ guildId, day: d, ...t, rate: rateOf(settings) }).catch(() => null);
  let rate = rateOf(settings); let changed = false;
  const inflation = await weeklyInflation(guildId, now);
  if (config.isOn(settings, 'bank')) {
    const p = config.params(settings, 'bank');
    if (p.autoRate && inflation !== null) {
      const min = p.minRate / 100;
      const next = inflation > p.inflationTarget ? Math.max(min, rate * 0.9) : inflation < p.inflationTarget / 2 ? Math.min(1, rate * 1.05) : rate;
      const rounded = Math.round(next * 100) / 100;
      if (rounded !== Math.round(rate * 100) / 100) {
        rate = rounded; changed = true;
        await sequelize.query('UPDATE guild_settings SET econRate = ? WHERE guildId = ?', { replacements: [rate, guildId] });
        settings.econRate = rate;
        await EconomySupply.update({ rate }, { where: { guildId, day: d } });
      }
    }
  }
  return { snapshot: t, inflation, rate, changed };
}

/** Everything the central bank page shows. */
async function report(guildId, settings, { days = 30 } = {}) {
  const since = day(new Date(Date.now() - days * 86400000));
  const [now, supply, earnRows, txRows, balances] = await Promise.all([
    totals(guildId),
    EconomySupply.findAll({ where: { guildId, day: { [require('sequelize').Op.gte]: since } }, order: [['day', 'ASC']], raw: true }),
    sequelize.query("SELECT kind, SUM(amount) AS s FROM economy_earn WHERE guildId = ? AND currency = 'coins' AND day >= ? GROUP BY kind", { replacements: [guildId, since], type: QueryTypes.SELECT }),
    sequelize.query("SELECT kind, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inS, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outS FROM economy_tx WHERE guildId = ? AND currency = 'coins' AND createdAt >= ? GROUP BY kind",
      { replacements: [guildId, since], type: QueryTypes.SELECT }),
    sequelize.query('SELECT balance FROM member_profiles WHERE guildId = ? AND balance > 0 ORDER BY balance DESC', { replacements: [guildId], type: QueryTypes.SELECT })
  ]);
  // Where money comes from (created) and where it goes (destroyed). Transfers between members move money, they don't make it.
  const SOURCES = { chat: 'Чат', voice: 'Голос', daily: '/daily', work: '/work', giveaway: 'Розыгрыши', admin: 'Начислено вручную', gift_in: 'Подарочные коды (выпуск админа)', refund: 'Возвраты из магазина' };
  const SINKS = { shop: 'Магазин', admin: 'Списано вручную', season: 'Сезоны (обнуление)' };
  const sources = []; const sinks = [];
  for (const r of earnRows) if (SOURCES[r.kind]) sources.push({ kind: r.kind, label: SOURCES[r.kind], amount: Number(r.s || 0) });
  for (const r of txRows) {
    if (SOURCES[r.kind] && r.kind !== 'gift_in' && Number(r.inS)) sources.push({ kind: r.kind, label: SOURCES[r.kind], amount: Number(r.inS) });
    if (SINKS[r.kind] && Number(r.outS)) sinks.push({ kind: r.kind, label: SINKS[r.kind], amount: Number(r.outS) });
  }
  // taxes: what members paid minus what the others received
  const pay = txRows.filter((r) => ['pay_out', 'pay_in', 'deal_hold', 'deal_in'].includes(r.kind));
  const paid = pay.filter((r) => /_out|_hold/.test(r.kind)).reduce((a, r) => a + Number(r.outS || 0), 0);
  const got = pay.filter((r) => /_in$/.test(r.kind)).reduce((a, r) => a + Number(r.inS || 0), 0);
  const taxes = Math.max(0, paid - got - (txRows.find((r) => r.kind === 'deal_refund') ? Number(txRows.find((r) => r.kind === 'deal_refund').inS || 0) : 0));
  if (taxes) sinks.push({ kind: 'tax', label: 'Налоги в казну', amount: taxes });
  sources.sort((a, b) => b.amount - a.amount); sinks.sort((a, b) => b.amount - a.amount);

  // Inequality: the smallest share of people that holds half of all coins, and the Gini coefficient.
  const vals = balances.map((r) => Number(r.balance));
  const total = vals.reduce((a, b) => a + b, 0);
  let acc = 0; let k = 0;
  for (const v of vals) { acc += v; k++; if (acc * 2 >= total) break; }
  const halfShare = vals.length ? (k / vals.length) * 100 : 0;
  let gini = 0;
  if (vals.length > 1 && total > 0) {
    const asc = vals.slice().sort((a, b) => a - b); let cum = 0;
    asc.forEach((v, i) => { cum += (i + 1) * v; });
    gini = (2 * cum) / (asc.length * total) - (asc.length + 1) / asc.length;
  }
  const inflation = await weeklyInflation(guildId);
  return { now, supply, sources, sinks, halfShare, halfPeople: k, people: vals.length, gini, inflation, rate: rateOf(settings), params: config.params(settings, 'bank') };
}

module.exports = { rateOf, totals, dailyStep, weeklyInflation, report };
