// DARK Coins — the platform's own currency, only for its paid features (promotion of communities). Separate from every
// server's coins and crystals: never exchanged for them, not touched by server admins or economy settings.
//
// Wallets: a person's (his Discord id) and a server's (g<guildId>, spent by those who manage the server).
// The ONLY ways a balance changes are here, each one transaction with a journal line and a unique operation key (the
// same key again does nothing and returns the first result), never below zero:
//   grant / revoke — the platform owner (BOT_OWNER_IDS), checked inside;
//   reward         — the platform's own rules (daily bonus, quests, the weekly top), with the daily emission limit;
//   queueReward    — rewards that wait 72 h and are checked again before paying (verified joins, votes);
//   charge         — a purchase on the platform (promotion);
//   creditPurchase / refundPurchase — DARK Coins bought for Telegram Stars (bot/modules/telegramShop.js).
const { Op } = require('sequelize');

class CoinError extends Error {}
const db = () => require('../../db');
const MAX_GRANT = 10_000_000;
const DAY = 86400000;
// The platform owners: BOT_OWNER_IDS, or — when it is not filled in — the owner of the bot's application in the Discord
// Developer Portal (read at start, see bot/events/ready.js). Without that fallback an empty BOT_OWNER_IDS left /platform
// closed to everybody and nobody could check the communities sent for review.
let appOwners = [];
const envOwners = () => (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const owners = () => (envOwners().length ? envOwners() : appOwners);
const setAppOwners = (ids) => { appOwners = (ids || []).map(String).filter((x) => /^\d{15,25}$/.test(x)); return appOwners; };
const isPlatformOwner = (userId) => Boolean(userId) && owners().includes(String(userId));
const isWallet = (v) => /^g?\d{15,25}$/.test(String(v || ''));
const guildWallet = (guildId) => `g${guildId}`;
const KEY_RE = /^[\w:.-]{4,100}$/;
const today = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const accountAge = (userId) => { try { return Date.now() - Number((BigInt(userId) >> 22n) + 1420070400000n); } catch { return 0; } };

// ---- the rules of earning: stored on the platform, changed only by its owner on /platform ----
const EARN_DEFAULTS = {
  join: 20, joinDailyCap: 200, joinMinAgeDays: 30, // a verified join from the catalog → the server's wallet
  vote: 2, votePaidPerDay: 3, // a vote → the voter
  daily: 5, dailyStreakMax: 5, dailyMinAgeDays: 30, // the platform's daily bonus → the person
  questPublish: 50, questJoins10: 100, questJoins100: 200, questJoins1000: 300, questMonth: 150, // one time per server
  top1: 500, top2: 300, top3: 150, // the weekly top of the catalog → the server
  holdHours: 72, // how long join and vote rewards wait
  emissionPerDay: 20000 // above this, automatic rewards of the day wait for the owner (held)
};
async function earnSettings() {
  const row = await db().PlatformSetting.findOne({ where: { key: 'earn' } });
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  const out = {};
  for (const [k, v] of Object.entries(EARN_DEFAULTS)) { const n = Math.trunc(Number(saved[k])); out[k] = Number.isFinite(n) && n >= 0 ? n : v; }
  return out;
}
async function setEarnSettings(actorId, values) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Это может только владелец платформы.');
  const cur = await earnSettings();
  for (const k of Object.keys(EARN_DEFAULTS)) {
    if (values[k] === undefined || values[k] === '') continue;
    const n = Math.trunc(Number(values[k]));
    if (!(n >= 0 && n <= 10_000_000)) throw new CoinError('Числа — от 0 до 10 000 000.');
    cur[k] = n;
  }
  await db().PlatformSetting.upsert({ key: 'earn', value: JSON.stringify(cur) });
  return cur;
}

async function walletOf(key) { return db().DarkWallet.findOne({ where: { userId: String(key) } }); }
async function balanceOf(key) { return Number((await walletOf(key))?.balance || 0); }
async function isFrozen(key) { return Boolean((await walletOf(key))?.frozen); }

async function history(key, limit = 30) {
  return db().DarkCoinTx.findAll({ where: key ? { userId: String(key) } : {}, order: [['id', 'DESC']], limit });
}

/**
 * Changes a wallet by `delta` (± whole coins) and writes the journal line. Inside a transaction `t` when given, else in its
 * own. Returns { tx, duplicate }. allowFrozen: only the owner's own operations may touch a frozen wallet.
 */
async function move(key, delta, { kind, opKey, actorId = null, note = null, allowFrozen = false }, t = null) {
  const { DarkWallet, DarkCoinTx, sequelize, inTransaction } = db();
  const d = Math.trunc(Number(delta));
  if (!isWallet(key)) throw new CoinError('Неверный ID пользователя.');
  if (!Number.isSafeInteger(d) || d === 0) throw new CoinError('Сумма должна быть целым числом, не нулём.');
  if (!KEY_RE.test(String(opKey || ''))) throw new CoinError('Нет ключа операции.');
  const run = async (tr) => {
    const seen = await DarkCoinTx.findOne({ where: { opKey }, transaction: tr });
    if (seen) return { tx: seen, duplicate: true };
    const [w] = await DarkWallet.findOrCreate({ where: { userId: String(key) }, defaults: { balance: 0 }, transaction: tr });
    if (w.frozen && !allowFrozen) throw new CoinError('Кошелёк заморожен администрацией платформы.');
    const [changed] = await DarkWallet.update({ balance: sequelize.literal(`balance + (${d})`) }, { where: { userId: String(key), balance: { [Op.gte]: Math.max(0, -d) } }, transaction: tr });
    if (!changed) throw new CoinError('Недостаточно DARK Coins.');
    const after = await DarkWallet.findOne({ where: { userId: String(key) }, transaction: tr });
    const tx = await DarkCoinTx.create({ userId: String(key), amount: d, balanceAfter: Number(after.balance), kind, opKey, actorId, note: note ? String(note).slice(0, 200) : null }, { transaction: tr });
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

// ---- the platform owner ----
async function grant({ actorId, userId, amount, note, opKey }) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Начислять DARK Coins может только владелец платформы.');
  const n = Math.trunc(Number(amount));
  if (!(n > 0 && n <= MAX_GRANT)) throw new CoinError(`Сумма — от 1 до ${MAX_GRANT}.`);
  return move(userId, n, { kind: 'grant', opKey: `grant:${opKey}`, actorId, note, allowFrozen: true });
}
async function revoke({ actorId, userId, amount, note, opKey }) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Списывать DARK Coins может только владелец платформы.');
  const n = Math.trunc(Number(amount));
  if (!(n > 0 && n <= MAX_GRANT)) throw new CoinError(`Сумма — от 1 до ${MAX_GRANT}.`);
  return move(userId, -n, { kind: 'revoke', opKey: `revoke:${opKey}`, actorId, note, allowFrozen: true });
}
/** Freezing: a frozen wallet gets no automatic rewards (they are cancelled) and can't spend. */
async function setFrozen(actorId, key, frozen) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Это может только владелец платформы.');
  if (!isWallet(key)) throw new CoinError('Неверный ID пользователя.');
  await db().DarkWallet.findOrCreate({ where: { userId: String(key) }, defaults: { balance: 0 } });
  await db().DarkWallet.update({ frozen: Boolean(frozen) }, { where: { userId: String(key) } });
}

// ---- purchases on the platform ----
function charge(key, amount, { kind, opKey, note, actorId }, t) {
  const n = Math.trunc(Number(amount));
  if (!(n > 0)) throw new CoinError('Цена должна быть больше нуля.');
  return move(key, -n, { kind, opKey, actorId: actorId || key, note }, t);
}

// ---- rewards by the platform's rules ----
const AUTO_KINDS = ['join', 'vote', 'daily', 'quest', 'top'];
/** How many coins the automatic rules gave today (UTC), for the daily emission limit. */
async function emittedToday() {
  return Number(await db().DarkCoinTx.sum('amount', { where: { kind: { [Op.in]: AUTO_KINDS }, amount: { [Op.gt]: 0 }, createdAt: { [Op.gte]: new Date(`${today()}T00:00:00Z`) } } }) || 0);
}

/** An instant reward (daily bonus, quest, weekly top). Refused for a frozen wallet; over the day's limit it waits (held). */
async function reward(key, amount, { kind, opKey, note }) {
  const n = Math.trunc(Number(amount));
  if (!(n > 0)) return null;
  const seen = await db().DarkCoinTx.findOne({ where: { opKey } });
  if (seen) return { tx: seen, duplicate: true };
  const s = await earnSettings();
  if (s.emissionPerDay && (await emittedToday()) + n > s.emissionPerDay) {
    await db().DarkCoinPending.findOrCreate({ where: { opKey }, defaults: { wallet: String(key), amount: n, kind, note, status: 'held', reason: 'дневной предел платформы', payAt: new Date() } });
    return { held: true };
  }
  return move(key, n, { kind, opKey, note });
}

/** A reward that waits (verified join, vote). Queued once per opKey. */
async function queueReward(key, amount, { kind, opKey, note, guildId = null, userId = null }) {
  const n = Math.trunc(Number(amount));
  if (!(n > 0) || !isWallet(key)) return null;
  const { holdHours } = await earnSettings();
  const [row, created] = await db().DarkCoinPending.findOrCreate({ where: { opKey }, defaults: { wallet: String(key), amount: n, kind, note, guildId, userId, payAt: new Date(Date.now() + holdHours * 3600000) } });
  return created ? row : null;
}

/** Is the condition of a waiting reward still true? Returns a reason to cancel, or null. */
async function stillValid(p) {
  if (await isFrozen(p.wallet)) return 'кошелёк заморожен';
  if (p.kind === 'join' && p.guildId && p.userId) {
    const guild = require('../../web/botBridge').getClient()?.guilds?.cache?.get(p.guildId);
    if (guild) {
      const member = await guild.members.fetch(p.userId).catch(() => null);
      if (!member) return 'участник вышел с сервера';
    }
  }
  if (p.kind === 'vote' && p.userId && (await isFrozen(p.userId))) return 'кошелёк заморожен';
  return null;
}

/** Pays the rewards whose waiting time is over (and cancels the ones whose condition broke). Returns { paid, cancelled, held }. */
async function settlePending(now = new Date()) {
  const { DarkCoinPending } = db();
  const due = await DarkCoinPending.findAll({ where: { status: 'pending', payAt: { [Op.lte]: now } }, order: [['id', 'ASC']], limit: 500 });
  const out = { paid: 0, cancelled: 0, held: 0 };
  const s = await earnSettings();
  let emitted = await emittedToday();
  for (const p of due) {
    const why = await stillValid(p);
    if (why) { await p.update({ status: 'cancelled', reason: why }); out.cancelled++; continue; }
    if (s.emissionPerDay && emitted + p.amount > s.emissionPerDay) { await p.update({ status: 'held', reason: 'дневной предел платформы' }); out.held++; continue; }
    try {
      const r = await move(p.wallet, p.amount, { kind: p.kind, opKey: p.opKey, note: p.note });
      await p.update({ status: 'paid' });
      if (!r.duplicate) { emitted += p.amount; out.paid++; await afterPaid(p).catch(() => {}); }
    } catch (err) {
      if (!(err instanceof CoinError)) throw err;
      await p.update({ status: 'cancelled', reason: err.message.slice(0, 200) }); out.cancelled++;
    }
  }
  return out;
}
/** The owner decides on a held or waiting reward. */
async function decidePending(actorId, id, approve) {
  if (!isPlatformOwner(actorId)) throw new CoinError('Это может только владелец платформы.');
  const p = await db().DarkCoinPending.findByPk(Number(id));
  if (!p || !['held', 'pending'].includes(p.status)) throw new CoinError('Начисление не найдено или уже решено.');
  if (!approve) { await p.update({ status: 'cancelled', reason: 'отменено владельцем платформы' }); return p; }
  await move(p.wallet, p.amount, { kind: p.kind, opKey: p.opKey, note: p.note, actorId });
  await p.update({ status: 'paid' });
  await afterPaid(p).catch(() => {});
  return p;
}

// quests of verified joins: counted when a join reward is paid
async function afterPaid(p) {
  if (p.kind !== 'join' || !p.guildId) return;
  const n = await db().CommunityJoin.count({ where: { guildId: p.guildId, rewarded: true } });
  const s = await earnSettings();
  for (const [goal, key] of [[10, 'questJoins10'], [100, 'questJoins100'], [1000, 'questJoins1000']]) {
    if (n >= goal) await reward(guildWallet(p.guildId), s[key], { kind: 'quest', opKey: `quest:${p.guildId}:joins${goal}`, note: `Задание: ${goal} подтверждённых входов` });
  }
}

// ---- sources ----
/**
 * A member really joined a server after pressing «Присоединиться» in the catalog (signed in). The server's wallet gets the
 * reward after the waiting time, if he is still there. Once per person and server; accounts younger than the rule, the
 * same network many times in a day and over the server's daily cap are not rewarded.
 */
async function onMemberJoined(guildId, userId) {
  const { CommunityJoin, Community } = db();
  const row = await CommunityJoin.findOne({ where: { guildId: String(guildId), userId: String(userId) } });
  if (!row || row.joinedAt || Date.now() - new Date(row.clickedAt).getTime() > DAY) return null;
  await row.update({ joinedAt: new Date() });
  const c = await Community.findOne({ where: { guildId: String(guildId), status: 'published' } });
  if (!c) return null;
  const s = await earnSettings();
  if (!s.join || accountAge(userId) < s.joinMinAgeDays * DAY) return null;
  if (row.ipHash && (await CommunityJoin.count({ where: { ipHash: row.ipHash, rewarded: true, joinedAt: { [Op.gte]: new Date(Date.now() - DAY) } } })) >= 3) return null;
  const todayKey = today();
  const queued = Number(await db().DarkCoinPending.sum('amount', { where: { wallet: guildWallet(guildId), kind: 'join', createdAt: { [Op.gte]: new Date(`${todayKey}T00:00:00Z`) } } }) || 0);
  if (queued + s.join > s.joinDailyCap) return null;
  await row.update({ rewarded: true });
  return queueReward(guildWallet(guildId), s.join, { kind: 'join', opKey: `join:${guildId}:${userId}`, note: `Вход из каталога: ${c.name}`, guildId: String(guildId), userId: String(userId) });
}

/** A vote: the voter gets a small reward for his first few votes a day (after the waiting time). */
async function onVote(userId, communityId, voteId) {
  const s = await earnSettings();
  if (!s.vote) return null;
  const counted = await db().DarkCoinPending.count({ where: { wallet: String(userId), kind: 'vote', createdAt: { [Op.gte]: new Date(`${today()}T00:00:00Z`) } } });
  if (counted >= s.votePaidPerDay) return null;
  return queueReward(String(userId), s.vote, { kind: 'vote', opKey: `vote:${voteId}`, note: 'Голос в каталоге', userId: String(userId) });
}

/** The platform's daily bonus. Needs an account older than the rule and a profile on at least one server with the bot. */
async function claimDaily(userId) {
  const { DarkDaily, MemberProfile } = db();
  const s = await earnSettings();
  if (!s.daily) throw new CoinError('Ежедневный бонус платформы сейчас выключен.');
  if (accountAge(userId) < s.dailyMinAgeDays * DAY) throw new CoinError(`Бонус доступен аккаунтам Discord старше ${s.dailyMinAgeDays} дней.`);
  if (!(await MemberProfile.findOne({ where: { userId: String(userId) }, attributes: ['id'] }))) throw new CoinError('Бонус — для участников серверов с ботом Dark: напишите что-нибудь на любом из них.');
  if (await isFrozen(userId)) throw new CoinError('Кошелёк заморожен администрацией платформы.');
  const day = today();
  const [row] = await DarkDaily.findOrCreate({ where: { userId: String(userId) }, defaults: { streak: 0 } });
  if (row.lastDay === day) throw new CoinError('Сегодня бонус уже получен. Следующий — после 00:00 UTC.');
  const yesterday = today(new Date(Date.now() - DAY));
  const streak = row.lastDay === yesterday ? Math.min(row.streak + 1, s.dailyStreakMax + 1) : 1;
  const amount = s.daily + (streak - 1);
  const r = await reward(String(userId), amount, { kind: 'daily', opKey: `daily:${userId}:${day}`, note: `Ежедневный бонус · серия ${streak}` });
  await row.update({ lastDay: day, streak });
  return { amount, streak, held: Boolean(r?.held) };
}
async function dailyState(userId) {
  const row = await db().DarkDaily.findOne({ where: { userId: String(userId) } });
  return { taken: row?.lastDay === today(), streak: row?.streak || 0 };
}

/** One-time quests of a server that are checked by time: published, 30 days in the catalog without a block. */
async function checkQuests(c) {
  if (!c || c.status !== 'published') return;
  const s = await earnSettings();
  const w = guildWallet(c.guildId);
  await reward(w, s.questPublish, { kind: 'quest', opKey: `quest:${c.guildId}:publish`, note: 'Задание: сообщество опубликовано' });
  if (c.publishedAt && Date.now() - new Date(c.publishedAt).getTime() >= 30 * DAY) await reward(w, s.questMonth, { kind: 'quest', opKey: `quest:${c.guildId}:month`, note: 'Задание: 30 дней в каталоге' });
}

/** The ISO week of a date, e.g. 2026-W46. */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`;
}
/** The weekly top: the three communities with the most votes during the last finished week (Mon–Sun, UTC). */
async function payWeeklyTop(now = new Date()) {
  const { CommunityVote, Community, sequelize } = db();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); // this Monday 00:00
  const start = new Date(end.getTime() - 7 * DAY);
  const week = isoWeek(start);
  const rows = await CommunityVote.findAll({ where: { createdAt: { [Op.gte]: start, [Op.lt]: end } }, attributes: ['communityId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['communityId'], order: [[sequelize.literal('n'), 'DESC']], limit: 10, raw: true });
  const s = await earnSettings();
  const prizes = [s.top1, s.top2, s.top3];
  let place = 0; const paid = [];
  for (const r of rows) {
    if (place >= 3) break;
    const c = await Community.findByPk(r.communityId);
    if (!c || c.status !== 'published') continue;
    const res = await reward(guildWallet(c.guildId), prizes[place], { kind: 'top', opKey: `top:${week}:${place + 1}`, note: `Топ недели ${week}: ${place + 1} место — ${c.name}` });
    paid.push({ place: place + 1, guildId: c.guildId, res });
    place++;
  }
  return { week, paid };
}

// ---- the scheduler: waiting rewards, quests, the weekly top ----
let timer = null;
function startDarkCoinsScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      await settlePending();
      for (const c of await db().Community.findAll({ where: { status: 'published' } })) await checkQuests(c);
      await payWeeklyTop();
    } catch (err) { require('../utils/logger').warn(`DARK Coins scheduler: ${err.message}`); }
  };
  timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref?.();
  setTimeout(tick, 30 * 1000).unref?.();
}

/** A fresh key for a form (put into a hidden field: sending the same form twice is one operation). */
const newKey = () => require('crypto').randomBytes(12).toString('hex');

module.exports = {
  CoinError, EARN_DEFAULTS, isPlatformOwner, owners, envOwners, setAppOwners, isWallet, guildWallet, accountAge, earnSettings, setEarnSettings, walletOf, balanceOf, isFrozen, history, move,
  grant, revoke, setFrozen, charge, reward, queueReward, settlePending, decidePending, emittedToday, onMemberJoined, onVote, claimDaily, dailyState,
  checkQuests, payWeeklyTop, isoWeek, startDarkCoinsScheduler, newKey, MAX_GRANT
};
