// Achievements: built-in ones (messages, voice, levels, economy, time on the server, events, special) counted from the data the
// bot already keeps, and a server's own ones (any of the same counters, a role, or given by hand) with a reward.
//
// How a member gets one: something happens (a message with XP, a voice minute, money in the journal, a purchase, a
// giveaway entry) → touch(guildId, userId) → a few seconds later ONE check of that member reads his numbers and unlocks what
// is reached. The unique index (guildId, userId, key) makes a second grant impossible; only the row that was really inserted
// pays the reward and is announced. A check of the same member never runs twice at the same time.
const { Op, QueryTypes } = require('sequelize');
const logger = require('../utils/logger');

const CATEGORIES = [
  ['messages', 'Сообщения', '💬'],
  ['voice', 'Голос', '🎙️'],
  ['levels', 'Уровни', '⭐'],
  ['economy', 'Экономика', '🪙'],
  ['other', 'Активность', '🎉'],
  ['special', 'Особые', '🏅']
];
const CATEGORY = Object.fromEntries(CATEGORIES.map(([k, label, emoji]) => [k, { key: k, label, emoji }]));
const RARITIES = [
  ['common', 'Обычное', '#9aa3b2'],
  ['uncommon', 'Необычное', '#5fc48a'],
  ['rare', 'Редкое', '#5a9cf0'],
  ['epic', 'Эпическое', '#a874f0'],
  ['legendary', 'Легендарное', '#f0b04a']
];
const RARITY = Object.fromEntries(RARITIES.map(([k, label, color], i) => [k, { key: k, label, color, rank: i }]));

// What can be counted. unit: how the progress reads; the server's own achievements pick one of these (or role / manual).
const METRICS = {
  messages: { label: 'Сообщений', unit: '' },
  voice_hours: { label: 'Часов в голосе', unit: 'ч' },
  voice_join: { label: 'Заходов в голос', unit: '' },
  level: { label: 'Уровень', unit: '' },
  balance: { label: 'Монет на балансе', unit: '' },
  crystals: { label: 'Кристаллов', unit: '' },
  earned: { label: 'Получений валюты', unit: '' },
  purchases: { label: 'Покупок в магазине', unit: '' },
  tenure_days: { label: 'Дней на сервере', unit: 'дн.' },
  events: { label: 'Участий в событиях', unit: '' },
  unlocked: { label: 'Других достижений', unit: '' }
};
const COND_TYPES = ['messages', 'voice_hours', 'level', 'balance', 'crystals', 'purchases', 'tenure_days', 'events', 'unlocked', 'role', 'manual'];

const B = (key, category, rarity, name, description, metric, value) => ({ key, builtin: true, category, rarity, name, description, metric, value });
const BUILTIN = [
  B('msg_1', 'messages', 'common', 'Первое слово', 'Написать первое сообщение', 'messages', 1),
  B('msg_100', 'messages', 'common', 'Разговорчивый', 'Написать 100 сообщений', 'messages', 100),
  B('msg_1000', 'messages', 'rare', 'Душа компании', 'Написать 1 000 сообщений', 'messages', 1000),
  B('msg_10000', 'messages', 'legendary', 'Голос сервера', 'Написать 10 000 сообщений', 'messages', 10000),
  B('voice_first', 'voice', 'common', 'Алло, слышно?', 'Впервые зайти в голосовой канал', 'voice_join', 1),
  B('voice_1h', 'voice', 'common', 'Первый час', 'Провести 1 час в голосовых каналах', 'voice_hours', 1),
  B('voice_10h', 'voice', 'uncommon', 'Завсегдатай', 'Провести 10 часов в голосовых каналах', 'voice_hours', 10),
  B('voice_100h', 'voice', 'epic', 'Живу в эфире', 'Провести 100 часов в голосовых каналах', 'voice_hours', 100),
  B('voice_1000h', 'voice', 'legendary', 'Тысяча часов', 'Провести 1 000 часов в голосовых каналах', 'voice_hours', 1000),
  B('lvl_5', 'levels', 'common', 'Уровень 5', 'Дойти до 5 уровня', 'level', 5),
  B('lvl_10', 'levels', 'uncommon', 'Уровень 10', 'Дойти до 10 уровня', 'level', 10),
  B('lvl_25', 'levels', 'rare', 'Уровень 25', 'Дойти до 25 уровня', 'level', 25),
  B('lvl_50', 'levels', 'epic', 'Уровень 50', 'Дойти до 50 уровня', 'level', 50),
  B('lvl_100', 'levels', 'legendary', 'Уровень 100', 'Дойти до 100 уровня', 'level', 100),
  B('eco_earn', 'economy', 'common', 'Первая монета', 'Впервые получить валюту сервера', 'earned', 1),
  B('eco_buy', 'economy', 'common', 'Первая покупка', 'Купить что-нибудь в магазине сервера', 'purchases', 1),
  B('eco_rich', 'economy', 'rare', 'Капитал', 'Накопить на балансе сумму, которую задал сервер', 'balance', null),
  B('stay_30', 'other', 'common', 'Свой человек', 'Пробыть на сервере 30 дней', 'tenure_days', 30),
  B('stay_180', 'other', 'uncommon', 'Старожил', 'Пробыть на сервере полгода', 'tenure_days', 180),
  B('stay_365', 'other', 'epic', 'Ветеран', 'Пробыть на сервере год', 'tenure_days', 365),
  B('event_1', 'other', 'common', 'Участник', 'Поучаствовать в событии сервера: розыгрыше или общей цели', 'events', 1),
  B('event_10', 'other', 'rare', 'Душа праздника', 'Поучаствовать в 10 событиях сервера', 'events', 10),
  B('collector_10', 'special', 'epic', 'Коллекционер', 'Открыть 10 других достижений', 'unlocked', 10)
];
const BUILTIN_BY_KEY = new Map(BUILTIN.map((a) => [a.key, a]));

const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const offList = (settings) => new Set(parseList(settings?.achievementsOff));
const balanceGoal = (settings) => Math.max(1, Math.min(1e9, Number(settings?.achievementsBalanceGoal) || 10000));
const isEnabled = (settings) => settings?.achievementsEnabled !== false && settings?.achievementsEnabled !== 0;
const db = () => require('../../db');

/** A server's own achievement as the same shape as a built-in one. */
function fromRow(r) {
  const x = typeof r.get === 'function' ? r.get({ plain: true }) : r;
  return {
    key: `c${x.id}`, id: x.id, builtin: false, category: CATEGORY[x.category] ? x.category : 'special', rarity: RARITY[x.rarity] ? x.rarity : 'common',
    name: x.name, description: x.description || '', emoji: x.emoji || '🏆', imageUrl: x.imageUrl || null,
    metric: x.condType === 'role' || x.condType === 'manual' ? null : x.condType, value: Number(x.condValue) || 0, condType: x.condType, roleId: x.condRoleId || null,
    reward: { coins: Number(x.rewardCoins) || 0, crystals: Number(x.rewardCrystals) || 0, roleId: x.rewardRoleId || null },
    enabled: x.enabled !== false && x.enabled !== 0, hidden: Boolean(x.hidden), manual: x.condType === 'manual'
  };
}

/** Every achievement of a server: the built-in ones (with on/off and the server's balance goal) and its own. */
async function catalog(guildId, settings) {
  const off = offList(settings);
  const goal = balanceGoal(settings);
  const builtin = BUILTIN.map((a) => ({ ...a, emoji: CATEGORY[a.category].emoji, value: a.key === 'eco_rich' ? goal : a.value,
    description: a.key === 'eco_rich' ? `Накопить ${goal.toLocaleString('ru-RU')} монет на балансе` : a.description, enabled: !off.has(a.key), reward: { coins: 0, crystals: 0, roleId: null } }));
  const own = (await db().Achievement.findAll({ where: { guildId }, order: [['id', 'ASC']] })).map(fromRow);
  return [...builtin, ...own];
}

/** The numbers of one member that achievements count (one query per kind of data, all small). */
async function metricsOf(guildId, userId, member = null) {
  const { MemberProfile, MemberAchievement, sequelize } = db();
  const p = await MemberProfile.findOne({ where: { guildId, userId }, raw: true });
  const one = async (sql) => Number((await sequelize.query(sql, { replacements: [guildId, userId], type: QueryTypes.SELECT }))[0]?.n || 0);
  const [purchases, giveaways, goals, earnedTx, earnedDay, unlocked] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM purchases WHERE guildId = ? AND userId = ?'),
    one('SELECT COUNT(*) AS n FROM giveaway_entries e JOIN giveaways g ON g.id = e.giveawayId WHERE g.guildId = ? AND e.userId = ?'),
    one('SELECT COUNT(*) AS n FROM economy_goal_contribs c JOIN economy_goals g ON g.id = c.goalId WHERE g.guildId = ? AND c.userId = ? AND c.amount > 0'),
    one('SELECT COUNT(*) AS n FROM economy_tx WHERE guildId = ? AND userId = ? AND amount > 0'),
    one('SELECT COUNT(*) AS n FROM economy_earn WHERE guildId = ? AND userId = ? AND amount > 0'),
    MemberAchievement.count({ where: { guildId, userId } })
  ]);
  let pending = 0;
  try { pending = require('./voiceTime').pendingSeconds?.(guildId, userId) || 0; } catch { /* voice tracking is optional here */ }
  const voiceSeconds = Number(p?.voiceSeconds || 0) + pending;
  const joined = member?.joinedTimestamp || (member?.joinedAt ? new Date(member.joinedAt).getTime() : null);
  return {
    messages: Number(p?.messageCount || 0),
    voice_hours: Math.floor(voiceSeconds / 3600),
    voice_seconds: voiceSeconds,
    voice_join: voiceSeconds > 0 || joinedVoice.has(`${guildId}:${userId}`) ? 1 : 0,
    level: Number(p?.level || 0),
    balance: Number(p?.balance || 0),
    crystals: Number(p?.crystals || 0),
    earned: earnedTx + earnedDay > 0 || Number(p?.balance || 0) > 0 ? 1 : 0,
    purchases,
    tenure_days: joined ? Math.floor((Date.now() - joined) / 86400000) : 0,
    events: giveaways + goals,
    unlocked,
    roles: member?.roles?.cache ? new Set(member.roles.cache.keys()) : new Set()
  };
}

/** Progress of one achievement for these numbers: { have, need, done, ratio }. */
function progress(a, m) {
  if (a.condType === 'role') { const done = m.roles.has(a.roleId); return { have: done ? 1 : 0, need: 1, done, ratio: done ? 1 : 0 }; }
  if (!a.metric) return { have: 0, need: 1, done: false, ratio: 0, manual: true };
  const need = Math.max(1, Number(a.value) || 1);
  const have = Math.max(0, Number(m[a.metric]) || 0);
  return { have, need, done: have >= need, ratio: Math.min(1, have / need) };
}

/**
 * Gives one achievement (once): inserts the row; only an inserted row pays the reward. Returns the achievement, or null when
 * the member already had it. grantedBy: who gave it by hand (null = it was earned).
 */
async function grant(guild, userId, a, grantedBy = null) {
  const guildId = guild.id || guild;
  // ONE transaction: the row and the coins/crystals of the reward — a stop in between can no longer leave the achievement
  // without its reward. The unique index decides: of two grants at the same moment only one insert succeeds.
  const r = a.reward || {};
  const ledger = require('./econ/ledger');
  try {
    await db().inTransaction(async (t) => {
      await db().MemberAchievement.create({ guildId, userId, key: a.key, grantedBy }, { transaction: t });
      if (r.coins > 0) await ledger.give(guildId, userId, 'balance', r.coins, 'achievement', { note: a.name }, t);
      if (r.crystals > 0) await ledger.give(guildId, userId, 'crystals', r.crystals, 'achievement', { note: a.name }, t);
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError' || /UNIQUE/i.test(String(err?.message))) return null;
    throw err;
  }
  if (r.roleId && guild.members) {
    const role = guild.roles.cache.get(r.roleId);
    const refusal = require('../utils/safeRole').selfGiveRefusal(role, guild);
    if (refusal) logger.warn(`achievement role ${r.roleId}: ${refusal}`);
    else await guild.members.fetch(userId).then((mem) => mem.roles.add(role, `Достижение: ${a.name}`)).catch((e) => logger.warn(`achievement role: ${e.message}`));
  }
  return a;
}

/** Takes an achievement back (the reward is not taken back). True when there was one. */
async function revoke(guildId, userId, key) {
  return (await db().MemberAchievement.destroy({ where: { guildId, userId, key } })) > 0;
}

/** Checks one member now and unlocks everything reached. Returns the new achievements (rarest first). */
async function check(guild, userId, { settings = null, member = null, announce = true, where = null } = {}) {
  const guildId = guild.id;
  settings = settings || (await require('./leveling').getOrCreateSettings(guildId));
  if (!isEnabled(settings)) return [];
  member = member || guild.members?.cache?.get(userId) || (await guild.members?.fetch?.(userId).catch(() => null));
  if (member?.user?.bot) return [];
  const list = (await catalog(guildId, settings)).filter((a) => a.enabled && !a.manual);
  const have = new Set((await db().MemberAchievement.findAll({ where: { guildId, userId }, attributes: ['key'], raw: true })).map((r) => r.key));
  const todo = list.filter((a) => !have.has(a.key));
  if (!todo.length) return [];
  const m = await metricsOf(guildId, userId, member);
  const fresh = [];
  // "other achievements" counts the ones unlocked in this same check too, so it goes last
  for (const a of todo.sort((x, y) => (x.metric === 'unlocked') - (y.metric === 'unlocked'))) {
    if (a.metric === 'unlocked') m.unlocked = have.size + fresh.length;
    if (!progress(a, m).done) continue;
    const got = await grant(guild, userId, a);
    if (got) fresh.push(got);
  }
  fresh.sort((x, y) => RARITY[y.rarity].rank - RARITY[x.rarity].rank);
  if (fresh.length && announce) await notify(guild, member, userId, fresh, settings, where).catch((e) => logger.warn(`achievement card: ${e.message}`));
  return fresh;
}

// ---- touch: "something happened to this member" → one check a few seconds later ----
const DELAY = 4000;
const timers = new Map(); // guildId:userId -> timeout
const running = new Set();
const joinedVoice = new Set(); // members seen entering voice (before their first minute is written)
const places = new Map(); // guildId:userId -> the channel where it happened (for the card)
function touch(guildId, userId, { channel = null, voiceJoin = false } = {}) {
  if (!guildId || !userId) return;
  const k = `${guildId}:${userId}`;
  if (voiceJoin) { if (joinedVoice.size > 50000) joinedVoice.clear(); joinedVoice.add(k); }
  if (channel) places.set(k, channel);
  if (timers.has(k)) return;
  if (timers.size > 20000) return; // something is very wrong: don't pile up timers
  const t = setTimeout(() => {
    timers.delete(k);
    if (running.has(k)) return touch(guildId, userId); // still checking: look again after it
    const client = require('../../web/botBridge').getClient();
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) { places.delete(k); return; }
    running.add(k);
    const where = places.get(k) || null; places.delete(k);
    check(guild, userId, { where }).catch((e) => logger.warn(`achievements: ${e.message}`)).finally(() => running.delete(k));
  }, DELAY);
  t.unref?.();
  timers.set(k, t);
}

// The voice tick touches every member each minute: check one at most every 10 minutes (a new level always checks).
const VOICE_EVERY = 10 * 60 * 1000;
const voiceChecked = new Map(); // guildId:userId -> time
function touchVoice(guildId, userId, channel = null, force = false) {
  const k = `${guildId}:${userId}`;
  const last = voiceChecked.get(k) || 0;
  if (!force && Date.now() - last < VOICE_EVERY) return;
  if (voiceChecked.size > 50000) voiceChecked.clear();
  voiceChecked.set(k, Date.now());
  touch(guildId, userId, { channel });
}

// ---- the card ----
const CARD_W = 900; const CARD_H = 300;
const imageCache = new Map(); // url -> Promise<Image|null>
function loadPicture(url) {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    if (imageCache.size > 200) imageCache.delete(imageCache.keys().next().value);
    const p = require('../utils/safeImage').fetchAvatar(url).then((data) => require('@napi-rs/canvas').loadImage(data)).catch(() => null);
    imageCache.set(url, p);
  }
  return imageCache.get(url);
}

// A vector icon per category (no emoji font is needed, so it never turns into a box).
function drawIcon(ctx, category, cx, cy, s, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const u = s / 2;
  ctx.beginPath();
  if (category === 'messages') {
    ctx.roundRect?.(-u * 0.8, -u * 0.6, u * 1.6, u * 1.05, u * 0.25); ctx.moveTo(-u * 0.3, u * 0.45); ctx.lineTo(-u * 0.55, u * 0.8); ctx.lineTo(0, u * 0.45); ctx.stroke();
  } else if (category === 'voice') {
    ctx.roundRect?.(-u * 0.25, -u * 0.8, u * 0.5, u * 0.95, u * 0.25); ctx.moveTo(-u * 0.6, -u * 0.1); ctx.quadraticCurveTo(-u * 0.6, u * 0.45, 0, u * 0.45); ctx.quadraticCurveTo(u * 0.6, u * 0.45, u * 0.6, -u * 0.1); ctx.moveTo(0, u * 0.45); ctx.lineTo(0, u * 0.8); ctx.stroke();
  } else if (category === 'levels') {
    for (let i = 0; i < 10; i++) { const r = i % 2 ? u * 0.38 : u * 0.85; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.stroke();
  } else if (category === 'economy') {
    ctx.arc(0, 0, u * 0.78, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, u * 0.5, 0, Math.PI * 2); ctx.stroke();
  } else if (category === 'other') {
    ctx.rect(-u * 0.75, -u * 0.55, u * 1.5, u * 1.3); ctx.moveTo(-u * 0.75, -u * 0.15); ctx.lineTo(u * 0.75, -u * 0.15); ctx.moveTo(-u * 0.35, -u * 0.8); ctx.lineTo(-u * 0.35, -u * 0.4); ctx.moveTo(u * 0.35, -u * 0.8); ctx.lineTo(u * 0.35, -u * 0.4); ctx.stroke();
  } else { // a cup
    ctx.moveTo(-u * 0.55, -u * 0.75); ctx.lineTo(u * 0.55, -u * 0.75); ctx.lineTo(u * 0.45, -u * 0.05); ctx.quadraticCurveTo(0, u * 0.35, -u * 0.45, -u * 0.05); ctx.closePath();
    ctx.moveTo(-u * 0.55, -u * 0.6); ctx.quadraticCurveTo(-u * 0.95, -u * 0.55, -u * 0.5, -u * 0.15); ctx.moveTo(u * 0.55, -u * 0.6); ctx.quadraticCurveTo(u * 0.95, -u * 0.55, u * 0.5, -u * 0.15);
    ctx.moveTo(0, u * 0.2); ctx.lineTo(0, u * 0.55); ctx.moveTo(-u * 0.35, u * 0.75); ctx.lineTo(u * 0.35, u * 0.75); ctx.stroke();
  }
  ctx.restore();
}

// Breaks a text into at most `lines` lines that fit the width (the last one ends with … when cut).
function wrap(ctx, text, width, lines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = []; let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= width) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === lines) break;
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length === lines && words.join(' ') !== out.join(' ')) {
    const { truncateToWidth } = require('./rankCard').cardKit;
    out[lines - 1] = truncateToWidth(ctx, `${out[lines - 1]} …`, width);
  }
  return out;
}

/** The picture «ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!»: the icon or picture, the name, the description, who got it, the rarity. */
async function renderCard({ achievement: a, userName, avatarUrl = null, more = 0, colors = null, headline = null, format = 'classic' }) {
  if (format === 'wide') return renderWideCard({ achievement: a, userName, avatarUrl, more, colors, headline });
  const { ensureFonts, makeCanvas, truncateToWidth, drawSquareAvatar, COLORS: BASE } = require('./rankCard').cardKit;
  const COLORS = colors || BASE; // the server's theme (appearance.js); the rarity keeps its own colour
  ensureFonts();
  const { canvas, ctx } = makeCanvas(CARD_W, CARD_H);
  const rar = RARITY[a.rarity] || RARITY.common;
  // the background: DARK's dark plate with a glow of the rarity's colour behind the icon
  ctx.fillStyle = COLORS.bg; ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, CARD_H, 26); ctx.fill();
  const glow = ctx.createRadialGradient(150, 150, 10, 150, 150, 260);
  glow.addColorStop(0, `${rar.color}55`); glow.addColorStop(1, `${rar.color}00`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = `${rar.color}aa`; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(1, 1, CARD_W - 2, CARD_H - 2, 25); ctx.stroke();
  // the medal
  ctx.fillStyle = COLORS.raised; ctx.beginPath(); ctx.arc(150, 150, 92, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rar.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(150, 150, 92, 0, Math.PI * 2); ctx.stroke();
  const pic = await loadPicture(a.imageUrl);
  if (pic) {
    ctx.save(); ctx.beginPath(); ctx.arc(150, 150, 84, 0, Math.PI * 2); ctx.clip();
    const k = Math.max(168 / pic.width, 168 / pic.height);
    ctx.drawImage(pic, 150 - (pic.width * k) / 2, 150 - (pic.height * k) / 2, pic.width * k, pic.height * k);
    ctx.restore();
  } else drawIcon(ctx, a.category, 150, 150, 96, rar.color);
  // the text
  const x = 280; const w = CARD_W - x - 40;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rar.color; ctx.font = '800 22px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, headline || 'ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!', w), x, 70);
  ctx.fillStyle = COLORS.paper; ctx.font = '800 40px CardSansBold, CardFallbackBold';
  let size = 40;
  while (size > 26 && ctx.measureText(a.name).width > w) { size -= 2; ctx.font = `800 ${size}px CardSansBold, CardFallbackBold`; }
  ctx.fillText(truncateToWidth(ctx, a.name, w), x, 120);
  ctx.fillStyle = COLORS.fog; ctx.font = '22px CardSans, CardFallback';
  wrap(ctx, a.description, w, 2).forEach((line, i) => ctx.fillText(line, x, 160 + i * 30));
  // who, and the rarity on the right
  const y = 232;
  if (avatarUrl) await drawSquareAvatar(ctx, avatarUrl, userName, x, y, 40, 12, rar.color, 2, COLORS).catch(() => {});
  ctx.fillStyle = COLORS.paper; ctx.font = '800 22px CardSansBold, CardFallbackBold';
  const label = `${RARITY[a.rarity].label} · ${CATEGORY[a.category]?.label || ''}`;
  ctx.font = '18px CardSans, CardFallback';
  const lw = ctx.measureText(label).width + 28;
  ctx.font = '800 22px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, userName, w - lw - 70), x + (avatarUrl ? 54 : 0), y + 28);
  ctx.fillStyle = `${rar.color}22`; ctx.beginPath(); ctx.roundRect(CARD_W - 40 - lw, y + 2, lw, 36, 18); ctx.fill();
  ctx.fillStyle = rar.color; ctx.font = '18px CardSans, CardFallback';
  ctx.fillText(label, CARD_W - 40 - lw + 14, y + 26);
  if (more > 0) {
    ctx.fillStyle = COLORS.fog; ctx.font = '18px CardSans, CardFallback';
    const t = `и ещё ${more}`;
    ctx.fillText(t, CARD_W - 40 - ctx.measureText(t).width, 70);
  }
  return canvas.toBuffer('image/png');
}

/**
 * «Широкий» format (as in MEE6): a long plate 1093 × 255 inside a 1140 × 302 picture with transparent margins.
 * The medal stands in its own square on the left (lit with the rarity's colour); on the right in three tiers: the headline
 * with «и ещё N», the name with the description, and under a thin line who got it and the rarity.
 */
async function renderWideCard({ achievement: a, userName, avatarUrl = null, more = 0, colors = null, headline = null }) {
  const { ensureFonts, truncateToWidth, drawSquareAvatar, roundRect, COLORS: BASE } = require('./rankCard').cardKit;
  const { openCard } = require('./lookCards');
  const C = colors || BASE;
  ensureFonts();
  const rar = RARITY[a.rarity] || RARITY.common;
  const { canvas, ctx, W, H } = openCard('wide', 0, 0, C, 22);
  // the medal's square: the rarity's light from the left, fading into the plate
  const S = H; // a square as high as the plate
  ctx.save(); roundRect(ctx, 0, 0, W, H, 22); ctx.clip();
  const light = ctx.createLinearGradient(0, 0, S + 60, 0);
  light.addColorStop(0, `${rar.color}38`); light.addColorStop(1, `${rar.color}00`);
  ctx.fillStyle = light; ctx.fillRect(0, 0, S + 60, H);
  const glow = ctx.createRadialGradient(S / 2, H / 2, 8, S / 2, H / 2, S * 0.62);
  glow.addColorStop(0, `${rar.color}50`); glow.addColorStop(1, `${rar.color}00`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, S + 40, H);
  ctx.fillStyle = rar.color; ctx.fillRect(0, 0, 6, H); // the rarity's line along the left edge
  ctx.restore();
  ctx.strokeStyle = `${rar.color}77`; ctx.lineWidth = 1.5; roundRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 22); ctx.stroke();
  // the medal
  const cx = S / 2 + 4; const cy = H / 2; const r = 86;
  ctx.save(); ctx.shadowColor = `${rar.color}88`; ctx.shadowBlur = 22;
  ctx.fillStyle = C.raised; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = rar.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const pic = await loadPicture(a.imageUrl);
  if (pic) {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 8, 0, Math.PI * 2); ctx.clip();
    const k = Math.max(((r - 8) * 2) / pic.width, ((r - 8) * 2) / pic.height);
    ctx.drawImage(pic, cx - (pic.width * k) / 2, cy - (pic.height * k) / 2, pic.width * k, pic.height * k);
    ctx.restore();
  } else drawIcon(ctx, a.category, cx, cy, 90, rar.color);

  const x = S + 20; const right = W - 36; const w = right - x;
  ctx.textBaseline = 'alphabetic';
  // tier 1: the headline, and «и ещё N» on the right
  let moreW = 0;
  if (more > 0) {
    ctx.font = '18px CardSans, CardFallback'; const t = `и ещё ${more}`; moreW = ctx.measureText(t).width + 16;
    ctx.fillStyle = C.fog; ctx.fillText(t, right - moreW + 16, 58);
  }
  ctx.fillStyle = rar.color; ctx.font = '800 19px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, headline || 'ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!', w - moreW), x, 58);
  // tier 2: the name and one line of description
  let size = 46; ctx.font = `800 ${size}px CardSansBold, CardFallbackBold`;
  while (size > 28 && ctx.measureText(a.name).width > w) { size -= 2; ctx.font = `800 ${size}px CardSansBold, CardFallbackBold`; }
  ctx.fillStyle = C.paper; ctx.fillText(truncateToWidth(ctx, a.name, w), x, 112);
  ctx.fillStyle = C.fog; ctx.font = '22px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, a.description || '', w), x, 150);
  // tier 3: a thin line, then who and the rarity
  ctx.fillStyle = C.hairline; ctx.fillRect(x, 174, w, 1);
  const y = 192; const av = 38;
  if (avatarUrl) await drawSquareAvatar(ctx, avatarUrl, userName, x, y, av, 11, rar.color, 2, C).catch(() => {});
  const label = `${rar.label} · ${CATEGORY[a.category]?.label || ''}`;
  ctx.font = '18px CardSans, CardFallback';
  const lw = ctx.measureText(label).width + 28;
  ctx.fillStyle = `${rar.color}22`; roundRect(ctx, right - lw, y + 1, lw, 36, 18); ctx.fill();
  ctx.fillStyle = rar.color; ctx.textBaseline = 'middle'; ctx.fillText(label, right - lw + 14, y + 19.5);
  ctx.fillStyle = C.paper; ctx.font = '800 22px CardSansBold, CardFallbackBold';
  const nx = x + (avatarUrl ? av + 14 : 0);
  ctx.fillText(truncateToWidth(ctx, userName, right - lw - 20 - nx), nx, y + 20);
  ctx.textBaseline = 'alphabetic';
  return canvas.toBuffer('image/png');
}

/** The message's options set in the panel: ping, the two buttons and their labels, the colour of the frame. */
function msgOptions(settings) {
  let o = {};
  try { o = JSON.parse(settings?.achievementsMsgOptions || '{}') || {}; } catch { o = {}; }
  const label = (v, d) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || d;
  return {
    ping: o.ping !== false,
    buttons: o.buttons !== false,
    mine: label(o.mine, 'Мои достижения'),
    all: label(o.all, 'Все достижения'),
    color: o.color === 'theme' ? 'theme' : 'rarity'
  };
}

// The names an own text can use (shown in the panel under the field).
const TEXT_VARS = [
  ['user', 'упоминание участника'], ['name', 'имя участника'], ['achievement', 'название достижения'], ['description', 'описание'],
  ['emoji', 'значок'], ['rarity', 'редкость'], ['category', 'раздел'], ['reward', 'награда одной строкой'],
  ['reward_line', '«Награда: …» или ничего'], ['coins', 'монет в награде'], ['crystals', 'кристаллов в награде'], ['role', 'роль в награде'],
  ['count', 'сколько достижений у участника'], ['more', 'сколько ещё открыто вместе'], ['others', 'список остальных открытых'], ['server', 'название сервера']
];

/** An own text with its {names} filled in. A line that held only names which came out empty is dropped. */
function fillText(template, vars, guild, member) {
  const { render } = require('../utils/replacers');
  const { usesTemplates } = require('../utils/messageBuilder');
  let ctx = {};
  if (usesTemplates(template).full) ctx = require('../utils/replacers').buildContext({ member, guild });
  return String(template).split('\n').map((line) => {
    const out = render(line, ctx, vars);
    return /\{/.test(line) && !out.trim() ? null : out;
  }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
}

/**
 * The message with the card and the buttons «Мои достижения» / «Все достижения». «Оформление» (appearance.js) decides
 * what it is made of: the picture card, the text with the reward, or both; in a frame or as plain text. The server may
 * write its own text (achievementsMessage), design its own frame (achievementsEmbedData) and set the options above.
 */
async function cardMessage(guild, member, userId, fresh, settings = null) {
  const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
  const appearance = require('./appearance');
  const look = settings ? appearance.read(settings) : await appearance.forGuild(guild.id);
  const shape = look.targets.achievement;
  const opt = msgOptions(settings);
  const a = fresh[0];
  const user = member?.user || (await guild.client?.users?.fetch?.(userId).catch(() => null));
  const name = member?.displayName || user?.globalName || user?.username || 'Участник';
  let file = null;
  if (shape.card) {
    const png = await module.exports.renderCard({ // through the drawing queue
      achievement: a, userName: name, avatarUrl: user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null, more: fresh.length - 1,
      colors: appearance.palette(look), headline: shape.headline, format: shape.format }).catch(() => null);
    if (png) file = new AttachmentBuilder(png, { name: 'achievement.png' });
  }
  const textOn = shape.text || !file;
  const othersList = fresh.slice(1, 6).map((x) => `${x.emoji || CATEGORY[x.category].emoji} **${x.name}** — ${x.description}`);
  const reward = rewardText(a.reward, guild);
  const custom = settings?.achievementsMessage && String(settings.achievementsMessage).trim();
  const { parseEmbed, hasBody } = require('../utils/messageBuilder');
  const own = parseEmbed(settings?.achievementsEmbedData);
  const ownFrame = own && hasBody(own) ? own : null;
  const who = member || { id: userId, user, displayName: name };
  let vars = null;
  if (custom || ownFrame) {
    const count = await db().MemberAchievement.count({ where: { guildId: guild.id, userId } }).catch(() => 0);
    vars = {
      user: `<@${userId}>`, name, achievement: a.name, description: a.description || '', emoji: a.emoji || CATEGORY[a.category]?.emoji || '🏆',
      rarity: (RARITY[a.rarity] || RARITY.common).label, category: CATEGORY[a.category]?.label || '', reward,
      reward_line: reward ? `Награда: ${reward}` : '', coins: a.reward?.coins || 0, crystals: a.reward?.crystals || 0,
      role: a.reward?.roleId ? `<@&${a.reward.roleId}>` : '', count, more: fresh.length - 1, others: othersList.join('\n'), server: guild.name || ''
    };
  }
  let text;
  if (custom) text = fillText(custom, vars, guild, who);
  else if (ownFrame) text = '';
  else text = [`<@${userId}> открывает достижение **${a.name}**!`, !file ? `*${a.description}*` : null, reward ? `Награда: ${reward}` : null, othersList.length ? `\nА ещё:\n${othersList.join('\n')}` : null].filter(Boolean).join('\n');
  const components = opt.buttons ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ach:mine').setLabel(opt.mine).setEmoji('🏆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ach:all').setLabel(opt.all).setEmoji('📜').setStyle(ButtonStyle.Secondary)
  )] : [];
  const color = opt.color === 'theme' ? appearance.embedColor(look) : parseInt((RARITY[a.rarity] || RARITY.common).color.slice(1), 16);
  const mention = `<@${userId}>`;
  const out = { content: opt.ping ? mention : '', embeds: [], files: file ? [file] : [], components, allowedMentions: opt.ping ? { users: [userId] } : { parse: [] } };
  if (textOn && ownFrame) { // the server's own frame: its text above it, the card inside it
    const { buildMessage } = require('../utils/messageBuilder');
    const images = { avatar: user?.displayAvatarURL?.({ extension: 'png', size: 256 }), icon: guild.iconURL?.({ extension: 'png', size: 256 }) };
    const built = buildMessage({ text: '', embed: ownFrame, fill: (t) => fillText(t, vars, guild, who), images, attachmentImage: file ? 'attachment://achievement.png' : null, defaultColor: color });
    out.embeds = built.embeds;
    out.content = text;
    if (opt.ping && !out.content.includes(mention)) out.content = `${mention} ${out.content}`.trim();
  } else if (textOn && shape.frame) {
    const embed = new EmbedBuilder().setColor(color).setDescription(text || '\u200b');
    if (file) embed.setImage('attachment://achievement.png');
    out.embeds = [embed];
  } else if (textOn) {
    out.content = opt.ping && !text.includes(mention) ? `${mention} ${text}` : text;
  }
  if (!out.content) delete out.content;
  return out;
}

function rewardText(r, guild) {
  if (!r) return '';
  const parts = [];
  if (r.coins > 0) parts.push(`${r.coins} монет`);
  if (r.crystals > 0) parts.push(`${r.crystals} кристаллов`);
  if (r.roleId) parts.push(`<@&${r.roleId}>`);
  void guild;
  return parts.join(', ');
}

/** Where the card goes: the chosen channel; "auto" — that channel, else where it happened; "dm" — in private. */
async function notify(guild, member, userId, fresh, settings, where) {
  const mode = ['auto', 'channel', 'dm', 'off'].includes(settings?.achievementsNotify) ? settings.achievementsNotify : 'auto';
  if (mode === 'off') return false;
  const payload = await cardMessage(guild, member, userId, fresh, settings);
  if (mode === 'dm') {
    const user = member?.user || (await guild.client.users.fetch(userId).catch(() => null));
    return Boolean(await require('./userData').sendOptionalDm(user, payload)); // nothing if he turned such messages off
  }
  let channel = null;
  if (settings?.achievementsChannelId) channel = guild.channels.cache.get(settings.achievementsChannelId) || (await guild.channels.fetch(settings.achievementsChannelId).catch(() => null));
  if (!channel && mode === 'auto') channel = where || null;
  if (!channel?.send) return false;
  const perms = channel.permissionsFor?.(guild.members?.me);
  if (perms && !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'])) return false;
  return Boolean(await channel.send(payload).catch(() => null));
}

// ---- lists for the buttons and /achievements ----
const bar = (r) => { const n = Math.round(r * 10); return '▰'.repeat(n) + '▱'.repeat(10 - n); };
const fmtNum = (n) => Math.trunc(Number(n) || 0).toLocaleString('ru-RU');

/** One member's achievements: what he has (with dates) and the closest ones still ahead. */
async function memberView(guild, userId, member = null) {
  const settings = await require('./leveling').getOrCreateSettings(guild.id);
  const list = (await catalog(guild.id, settings)).filter((a) => a.enabled);
  const rows = await db().MemberAchievement.findAll({ where: { guildId: guild.id, userId }, order: [['createdAt', 'DESC']], raw: true });
  const got = new Map(rows.map((r) => [r.key, r]));
  const m = await metricsOf(guild.id, userId, member || guild.members?.cache?.get(userId));
  const items = list.map((a) => ({ a, p: progress(a, m), at: got.get(a.key)?.createdAt || null, has: got.has(a.key) }));
  return { settings, items, have: items.filter((x) => x.has), total: items.filter((x) => !x.a.hidden || x.has).length, metrics: m };
}

function memberEmbed(view, name) {
  const { EmbedBuilder } = require('discord.js');
  const have = view.have.sort((x, y) => new Date(y.at) - new Date(x.at));
  const next = view.items.filter((x) => !x.has && !x.a.hidden && !x.p.manual).sort((x, y) => y.p.ratio - x.p.ratio).slice(0, 5);
  const e = new EmbedBuilder().setColor(0xe3a857).setTitle(`🏆 Достижения: ${name}`)
    .setDescription(`Открыто **${have.length}** из **${view.total}**.`);
  e.addFields({ name: 'Открыто', value: have.length ? have.slice(0, 12).map((x) => `${x.a.emoji || CATEGORY[x.a.category].emoji} **${x.a.name}** · ${RARITY[x.a.rarity].label}${x.at ? ` · <t:${Math.floor(new Date(x.at).getTime() / 1000)}:d>` : ''}`).join('\n') + (have.length > 12 ? `\n…и ещё ${have.length - 12}` : '') : 'Пока ни одного — всё впереди.' });
  if (next.length) e.addFields({ name: 'Ближе всего', value: next.map((x) => `${x.a.emoji || CATEGORY[x.a.category].emoji} **${x.a.name}** — ${x.a.description}\n${bar(x.p.ratio)} ${fmtNum(x.p.have)} / ${fmtNum(x.p.need)}`).join('\n') });
  return e;
}

function catalogEmbed(view, category = null) {
  const { EmbedBuilder } = require('discord.js');
  const e = new EmbedBuilder().setColor(0xe3a857).setTitle('📜 Все достижения сервера')
    .setDescription(`Открыто вами: **${view.have.length}** из **${view.total}**. Скрытые показываются, когда их откроют.`);
  for (const [key, label, emoji] of CATEGORIES) {
    if (category && key !== category) continue;
    const list = view.items.filter((x) => x.a.category === key && (!x.a.hidden || x.has));
    if (!list.length) continue;
    const text = list.map((x) => `${x.has ? '✅' : '🔒'} **${x.a.name}** — ${x.a.description}${!x.has && !x.p.manual ? ` (${fmtNum(x.p.have)}/${fmtNum(x.p.need)})` : ''}`).join('\n');
    e.addFields({ name: `${emoji} ${label}`, value: text.length > 1024 ? `${text.slice(0, 1020)}…` : text });
  }
  return e;
}

/** The category menu under the catalog. */
function catalogMenu(selected = null) {
  const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ach:cat').setPlaceholder('Категория')
    .addOptions([{ label: 'Все категории', value: 'all', emoji: '📜', default: !selected }, ...CATEGORIES.map(([k, label, emoji]) => ({ label, value: k, emoji, default: selected === k }))]));
}

const isAchievementComponent = (i) => typeof i.customId === 'string' && /^ach:(mine|all|cat|of:\d{15,25})$/.test(i.customId);

/** The card's buttons and the category menu: answered only to the person who pressed. */
async function handleComponent(interaction) {
  const settings = await require('./leveling').getOrCreateSettings(interaction.guild.id);
  if (!isEnabled(settings)) return interaction.reply({ content: 'Достижения на этом сервере выключены.', flags: require('discord.js').MessageFlags.Ephemeral });
  const view = await memberView(interaction.guild, interaction.user.id, interaction.member);
  const name = interaction.member?.displayName || interaction.user.username;
  if (interaction.customId.startsWith('ach:of:')) {
    const id = interaction.customId.slice(7);
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    const other = await memberView(interaction.guild, id, member);
    return interaction.reply({ embeds: [memberEmbed(other, member?.displayName || 'Участник')], flags: require('discord.js').MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'ach:mine') return interaction.reply({ embeds: [memberEmbed(view, name)], flags: require('discord.js').MessageFlags.Ephemeral });
  if (interaction.customId === 'ach:all') return interaction.reply({ embeds: [catalogEmbed(view)], components: [catalogMenu()], flags: require('discord.js').MessageFlags.Ephemeral });
  const cat = interaction.values?.[0];
  const category = CATEGORY[cat] ? cat : null;
  return interaction.update({ embeds: [catalogEmbed(view, category)], components: [catalogMenu(category)] });
}

/** Counts for the panel: how many members have each achievement, and in total. */
async function stats(guildId) {
  const { MemberAchievement, sequelize } = db();
  const [byKey, members, total, recent] = await Promise.all([
    MemberAchievement.findAll({ where: { guildId }, attributes: ['key', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['key'], raw: true }),
    MemberAchievement.count({ where: { guildId }, distinct: true, col: 'userId' }),
    MemberAchievement.count({ where: { guildId } }),
    MemberAchievement.findAll({ where: { guildId }, order: [['id', 'DESC']], limit: 15, raw: true })
  ]);
  const week = await MemberAchievement.count({ where: { guildId, createdAt: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } } });
  return { byKey: Object.fromEntries(byKey.map((r) => [r.key, Number(r.n)])), members, total, recent, week };
}

module.exports = {
  CATEGORIES, CATEGORY, RARITIES, RARITY, METRICS, COND_TYPES, BUILTIN, BUILTIN_BY_KEY,
  catalog, fromRow, metricsOf, progress, grant, revoke, check, touch, touchVoice, renderCard: require('../utils/renderQueue').limited(renderCard), renderWideCard: require('../utils/renderQueue').limited(renderWideCard), cardMessage, msgOptions, fillText, TEXT_VARS, notify, memberView, memberEmbed, catalogEmbed, catalogMenu,
  isAchievementComponent, handleComponent, stats, isEnabled, offList, balanceGoal, rewardText
};
