// Казна: taxes on transfers, purchases and deals collect here. The admin spends it from the panel — or lets the members decide:
// a treasury vote is an ordinary poll in the events channel whose winning option the bot carries out when it ends.
//   split    — share an amount equally among everyone who was active in the last 7 days;
//   giveaway — a coin giveaway paid by the treasury;
//   goal     — put an amount into an open server goal.
const { QueryTypes } = require('sequelize');
const { sequelize, inTransaction, Poll, EconomyGoal, GuildSettings } = require('../../../db');
const embeds = require('../../utils/embeds');
const ledger = require('./ledger');
const wallet = require('../wallet');
const events = require('./events');
const logger = require('../../utils/logger');

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣'];

/** Members active in the last 7 days (they earned from chat or voice). */
async function activeMembers(guildId, days = 7) {
  const rows = await sequelize.query('SELECT DISTINCT userId FROM economy_earn WHERE guildId = ? AND day >= ? AND kind IN (\'chat\', \'voice\')',
    { replacements: [guildId, ledger.day(new Date(Date.now() - days * 86400000))], type: QueryTypes.SELECT });
  return rows.map((r) => r.userId);
}

/** Shares `amount` equally among the active members. Returns { people, each } or { error }. */
async function split(guildId, amount) {
  const ids = await activeMembers(guildId);
  if (!ids.length) return { error: 'nobody' };
  const each = Math.floor(amount / ids.length);
  if (each < 1) return { error: 'small' };
  const ok = await inTransaction(async (t) => {
    if (!(await ledger.treasuryTake(guildId, each * ids.length, t))) return false;
    for (const id of ids) await wallet.credit(guildId, id, 'balance', each, t);
    await ledger.record(ids.map((id) => ({ guildId, userId: id, amount: each, kind: 'treasury', note: 'раздача' })), t);
    return true;
  });
  return ok ? { people: ids.length, each } : { error: 'treasury' };
}

/** A coin giveaway paid by the treasury, in the events channel. Returns { giveaway } or { error }. */
async function giveaway(settings, { amount, winners, hours }) {
  const guildId = settings.guildId;
  const c = require('../../../web/botBridge').getClient?.();
  const ch = await events.channelOf(settings, c);
  if (!ch) return { error: 'channel' };
  const total = amount * winners;
  if (!(await inTransaction((t) => ledger.treasuryTake(guildId, total, t)))) return { error: 'treasury' };
  try {
    const g = await require('../giveaways').startGiveaway({ guild: ch.guild, channel: ch, channelId: ch.id, user: c.user }, {
      prize: `${fmt(amount)} ${settings.currencyName || 'монет'} из казны сервера`, durationMs: hours * 3600000, winners, reward: { type: 'coins', amount }, channel: ch
    });
    return { giveaway: g };
  } catch (err) {
    await ledger.treasuryAdd(guildId, total); // could not post: the money goes back
    logger.warn?.(`Treasury giveaway failed: ${err.message}`);
    return { error: 'post' };
  }
}

/** Puts treasury money into an open goal. */
async function toGoal(guildId, goalId, amount) {
  return require('./goals').contribute(guildId, goalId, '', amount);
}

const describe = (o, settings, goal) => o.kind === 'split' ? `Раздать ${fmt(o.amount)} поровну всем, кто был активен за неделю`
  : o.kind === 'giveaway' ? `Розыгрыш: ${o.winners} × ${fmt(o.amount)} ${settings.currencyName || 'монет'}`
    : `В общую цель «${goal?.title || '?'}» — ${fmt(o.amount)}`;

/**
 * Starts a treasury vote in the events channel. options: [{ kind, amount, winners?, hours?, goalId? }] (2–3). Returns { poll } or { error }.
 */
async function startVote(settings, options, hours) {
  const c = require('../../../web/botBridge').getClient?.();
  const ch = await events.channelOf(settings, c);
  if (!ch) return { error: 'channel' };
  const goals = await EconomyGoal.findAll({ where: { guildId: settings.guildId, status: 'open' }, raw: true });
  const labels = options.map((o) => describe(o, settings, goals.find((g) => g.id === Number(o.goalId))));
  const endsAt = new Date(Date.now() + hours * 3600000);
  const question = 'На что потратить казну?';
  const embed = embeds.baseEmbed().setTitle(`📊 ${question}`)
    .setDescription(`${labels.map((l, i) => `${NUMBERS[i]} ${l}`).join('\n')}\n\nВ казне сейчас: **${fmt(await ledger.treasuryOf(settings.guildId))}**.\nГолосуйте реакциями — бот сам выполнит то, что победит.\n⏳ Итоги <t:${Math.floor(endsAt.getTime() / 1000)}:R>`);
  const msg = await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  if (!msg) return { error: 'post' };
  for (const e of NUMBERS.slice(0, options.length)) await msg.react(e).catch(() => {});
  const poll = await Poll.create({ guildId: settings.guildId, channelId: ch.id, messageId: msg.id, question, options: JSON.stringify(labels.map((label, i) => ({ emoji: NUMBERS[i], label }))), endsAt, action: JSON.stringify({ type: 'treasury', options }) });
  require('../../utils/scheduler').poke('polls');
  return { poll };
}

/** Called by the polls module when a treasury vote ends: does the winning option (ties: the first). */
async function runVote(poll, counts) {
  let action; try { action = JSON.parse(poll.action || 'null'); } catch { action = null; }
  if (!action || action.type !== 'treasury' || !Array.isArray(action.options)) return null;
  const settings = await GuildSettings.findOne({ where: { guildId: poll.guildId } });
  const best = Math.max(0, ...counts);
  const i = best > 0 ? counts.indexOf(best) : -1;
  if (i < 0) { await events.post(settings, embeds.info('Голосование по казне закончилось без голосов — казна не тронута.')); return null; }
  const o = action.options[i];
  let r;
  if (o.kind === 'split') r = await split(poll.guildId, o.amount);
  else if (o.kind === 'giveaway') r = await giveaway(settings, { amount: o.amount, winners: o.winners || 1, hours: o.hours || 24 });
  else r = await toGoal(poll.guildId, Number(o.goalId), o.amount);
  const failed = r?.error || r?.ok === false;
  await events.post(settings, failed ? embeds.error('Казна не смогла выполнить решение голосования: в ней не хватает денег или цель уже закрыта.')
    : embeds.success(`Решение голосования выполнено: ${describe(o, settings, await EconomyGoal.findByPk(Number(o.goalId)))}.`));
  return r;
}

module.exports = { activeMembers, split, giveaway, toGoal, startVote, runVote };
