// «Сообщества DARK»: the public catalog of servers. Listing, editing and removing are for the server's owner or an admin who
// manages it (checked by the panel's guild access). Votes are limited per account, per network and by account age. Paid
// promotion is bought with DARK Coins (bot/modules/darkCoins.js) at prices the platform owner sets; it switches on at
// once and ends by itself when its time is over.
const { Op } = require('sequelize');
const crypto = require('crypto');

class CommunityError extends Error {}
const db = () => require('../../db');
const coins = () => require('./darkCoins');
const client = () => require('../../web/botBridge').getClient();

const CATEGORIES = [
  ['gaming', 'Игры', '🎮'], ['social', 'Общение', '💬'], ['anime', 'Аниме', '🌸'], ['music', 'Музыка', '🎵'],
  ['art', 'Творчество', '🎨'], ['tech', 'Технологии', '💻'], ['study', 'Учёба', '📚'], ['rp', 'Ролевые игры', '🎭'],
  ['memes', 'Мемы', '😂'], ['sport', 'Спорт', '⚽'], ['crypto', 'Финансы', '📈'], ['other', 'Другое', '✨']
];
const CATEGORY = Object.fromEntries(CATEGORIES.map(([k, label, emoji]) => [k, { key: k, label, emoji }]));
const PROMOS = {
  bump: { label: 'Поднятие', desc: 'Сообщество поднимается в начало каталога (после закреплённых) на сутки.', perDay: false, def: 50 },
  pin: { label: 'Закрепление', desc: 'Карточка стоит в самом верху каталога, над всеми остальными.', perDay: true, def: 300 },
  highlight: { label: 'Выделение', desc: 'Карточка выделена цветной рамкой и значком в каталоге.', perDay: true, def: 100 },
  featured: { label: 'Рекомендации', desc: 'Сообщество показывается в блоке «Рекомендуем» над каталогом.', perDay: true, def: 200 }
};
const DAYS = [1, 3, 7, 14, 30];
const SORTS = { popular: 'Популярные', votes: 'По голосам', members: 'По участникам', new: 'Новые' };
const PER_PAGE = 12;
const VOTE_EVERY = 12 * 3600 * 1000;
const MIN_ACCOUNT_AGE = 7 * 86400000;
const IP_VOTES_PER_HOUR = 10;

const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const listOf = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const accountAge = (userId) => { try { return Date.now() - Number((BigInt(userId) >> 22n) + 1420070400000n); } catch { return 0; } };
const ipHash = (ip) => (ip ? crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || 'dark'}:${ip}`).digest('hex').slice(0, 32) : null);
const iconUrl = (c) => (c.iconHash ? `https://cdn.discordapp.com/icons/${c.guildId}/${c.iconHash}.${String(c.iconHash).startsWith('a_') ? 'gif' : 'png'}?size=128` : null);
const BANNER_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'i.imgur.com'];

// ---- platform settings (prices, pre-moderation) ----
async function platform() {
  const rows = await db().PlatformSetting.findAll();
  const o = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const prices = {};
  for (const [k, p] of Object.entries(PROMOS)) prices[k] = Math.max(1, Number(o[`price_${k}`]) || p.def);
  return { prices, premoderation: o.premoderation === '1' };
}
async function setPlatform(actorId, { prices = {}, premoderation }) {
  if (!coins().isPlatformOwner(actorId)) throw new CommunityError('Это может только владелец платформы.');
  const { PlatformSetting } = db();
  for (const k of Object.keys(PROMOS)) {
    if (prices[k] === undefined) continue;
    const v = Math.trunc(Number(prices[k]));
    if (!(v >= 1 && v <= 1_000_000)) throw new CommunityError('Цена — от 1 до 1 000 000 DARK Coins.');
    await PlatformSetting.upsert({ key: `price_${k}`, value: String(v) });
  }
  if (premoderation !== undefined) await PlatformSetting.upsert({ key: 'premoderation', value: premoderation ? '1' : '0' });
}

// ---- the listing, written by its server's admin ----
function cleanInvite(v) {
  const s = String(v || '').trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/.exec(s);
  if (!m) throw new CommunityError('Ссылка-приглашение должна быть вида https://discord.gg/код.');
  return `https://discord.gg/${m[1]}`;
}
function cleanBanner(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let u; try { u = new URL(s); } catch { throw new CommunityError('Ссылка на баннер некорректна.'); }
  if (u.protocol !== 'https:' || !BANNER_HOSTS.includes(u.hostname) || s.length > 300) throw new CommunityError(`Баннер — картинка по https с ${BANNER_HOSTS.join(', ')}.`);
  return s;
}

/** Fields of a listing from a form, checked. */
function cleanFields(b) {
  const name = String(b.name || '').trim().slice(0, 60);
  const shortDesc = String(b.shortDesc || '').trim().slice(0, 160);
  const description = String(b.description || '').trim().slice(0, 4000);
  if (name.length < 2) throw new CommunityError('Название — хотя бы 2 символа.');
  if (shortDesc.length < 10) throw new CommunityError('Короткое описание — хотя бы 10 символов.');
  const cats = [...new Set([].concat(b.categories || []).map(String).filter((k) => CATEGORY[k]))].slice(0, 3);
  if (!cats.length) throw new CommunityError('Выберите хотя бы одну категорию (до трёх).');
  const tags = [...new Set(String(b.tags || '').split(',').map((t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 20)).filter(Boolean))].slice(0, 6);
  return { name, shortDesc, description, categories: cats.join(','), tags: tags.join(','), inviteUrl: cleanInvite(b.inviteUrl), bannerUrl: cleanBanner(b.bannerUrl) };
}

/** Adds or updates the server's listing. A blocked one stays blocked; with pre-moderation a new one waits. */
async function save(guildId, userId, body) {
  const { Community } = db();
  const fields = cleanFields(body);
  const g = client()?.guilds?.cache?.get(String(guildId));
  const live = g ? { iconHash: g.icon || null, memberCount: g.memberCount || 0 } : {};
  const row = await Community.findOne({ where: { guildId: String(guildId) } });
  if (row) {
    if (row.status === 'blocked') throw new CommunityError('Сообщество заблокировано модерацией платформы — изменить его нельзя.');
    await row.update({ ...fields, ...live });
    return row;
  }
  const { premoderation } = await platform();
  return Community.create({ guildId: String(guildId), ownerId: userId, ...fields, ...live, status: premoderation ? 'pending' : 'published', publishedAt: premoderation ? null : new Date() });
}

/** The owner hides / shows his listing (blocked and pending ones he can't publish himself). */
async function setVisible(guildId, visible) {
  const row = await db().Community.findOne({ where: { guildId: String(guildId) } });
  if (!row) throw new CommunityError('Сообщества нет в каталоге.');
  if (['blocked', 'pending'].includes(row.status)) throw new CommunityError(row.status === 'blocked' ? 'Заблокировано модерацией платформы.' : 'Ждёт проверки модерацией платформы.');
  await row.update({ status: visible ? 'published' : 'hidden', publishedAt: visible && !row.publishedAt ? new Date() : row.publishedAt });
  return row;
}

/** Removes the listing with its votes and statistics (promotions and the coin journal stay in the history). */
async function remove(guildId) {
  const { Community, CommunityVote, CommunityStat, CommunityReport, inTransaction } = db();
  const row = await Community.findOne({ where: { guildId: String(guildId) } });
  if (!row) return false;
  if (row.status === 'blocked') throw new CommunityError('Заблокированное сообщество удалить нельзя — напишите модерации платформы.');
  await inTransaction(async (t) => {
    for (const M of [CommunityVote, CommunityStat, CommunityReport]) await M.destroy({ where: { communityId: row.id }, transaction: t });
    await row.destroy({ transaction: t });
  });
  return true;
}

/** Platform moderation: publish, hide or block, with a note the owner sees. */
async function moderate(actorId, communityId, status, note = '') {
  if (!coins().isPlatformOwner(actorId)) throw new CommunityError('Это может только модерация платформы.');
  if (!['published', 'hidden', 'blocked'].includes(status)) throw new CommunityError('Неизвестное действие.');
  const row = await db().Community.findByPk(Number(communityId));
  if (!row) throw new CommunityError('Сообщество не найдено.');
  await row.update({ status, moderationNote: String(note || '').slice(0, 300) || null, publishedAt: status === 'published' && !row.publishedAt ? new Date() : row.publishedAt });
  return row;
}

// ---- promotions ----
async function activePromos(ids = null) {
  const where = { endsAt: { [Op.gt]: new Date() } };
  if (ids) where.communityId = { [Op.in]: ids };
  const rows = await db().CommunityPromotion.findAll({ where, raw: true });
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.communityId)) by.set(r.communityId, {});
    const o = by.get(r.communityId);
    if (!o[r.kind] || new Date(o[r.kind].endsAt) < new Date(r.endsAt)) o[r.kind] = r;
  }
  return by;
}

/**
 * Buys a promotion with the buyer's DARK Coins: the payment and the promotion are written in ONE transaction, keyed by the
 * form's operation key — a second click with the same key charges nothing and returns the same promotion. The same kind
 * already running is extended (it starts when the current one ends).
 */
async function buy(guildId, buyerId, kind, days, opKey) {
  const { Community, CommunityPromotion, inTransaction } = db();
  const p = PROMOS[kind];
  if (!p) throw new CommunityError('Неизвестный вид продвижения.');
  const d = p.perDay ? Math.trunc(Number(days)) : 1;
  if (p.perDay && !DAYS.includes(d)) throw new CommunityError('Выберите срок из списка.');
  const row = await Community.findOne({ where: { guildId: String(guildId) } });
  if (!row || row.status !== 'published') throw new CommunityError('Продвигать можно только опубликованное сообщество.');
  const { prices } = await platform();
  const price = prices[kind] * (p.perDay ? d : 1);
  const key = `promo:${buyerId}:${opKey}`;
  return inTransaction(async (t) => {
    const { tx, duplicate } = await coins().charge(buyerId, price, { kind: 'promo', opKey: key, note: `${p.label} · ${row.name}${p.perDay ? ` · ${d} дн.` : ''}` }, t);
    if (duplicate) {
      const was = await CommunityPromotion.findOne({ where: { txId: tx.id }, transaction: t });
      return { promotion: was, duplicate: true };
    }
    const now = new Date();
    const current = await CommunityPromotion.findOne({ where: { communityId: row.id, kind, endsAt: { [Op.gt]: now } }, order: [['endsAt', 'DESC']], transaction: t });
    const startsAt = kind !== 'bump' && current ? new Date(current.endsAt) : now;
    const endsAt = new Date(startsAt.getTime() + d * 86400000);
    const promotion = await CommunityPromotion.create({ communityId: row.id, kind, days: d, price, buyerId, txId: tx.id, startsAt, endsAt }, { transaction: t });
    if (kind === 'bump') await row.update({ bumpedAt: now }, { transaction: t });
    return { promotion, duplicate: false };
  });
}

// ---- statistics, views, clicks, votes ----
async function countStat(communityId, field) {
  const { sequelize } = db();
  await sequelize.query(`INSERT INTO community_stats (communityId, day, ${field}) VALUES (?, ?, 1) ON CONFLICT (communityId, day) DO UPDATE SET ${field} = ${field} + 1`, { replacements: [communityId, day()] });
  await sequelize.query(`UPDATE communities SET ${field} = ${field} + 1 WHERE id = ?`, { replacements: [communityId] });
}
// a view is counted once per visitor per community per hour (kept in memory)
const seenViews = new Map();
async function view(communityId, visitorKey) {
  const k = `${communityId}:${visitorKey}`;
  const last = seenViews.get(k) || 0;
  if (Date.now() - last < 3600000) return false;
  if (seenViews.size > 100000) seenViews.clear();
  seenViews.set(k, Date.now());
  await countStat(communityId, 'views');
  return true;
}
const click = (communityId) => countStat(communityId, 'clicks');

/** A vote: one per account per community every 12 hours; accounts younger than 7 days can't vote; a network is limited. */
async function vote(communityId, userId, ip) {
  const { Community, CommunityVote } = db();
  const row = await Community.findByPk(Number(communityId));
  if (!row || row.status !== 'published') throw new CommunityError('Сообщество не найдено.');
  if (accountAge(userId) < MIN_ACCOUNT_AGE) throw new CommunityError('Голосовать можно с аккаунта Discord старше 7 дней.');
  const lock = require('../utils/lock');
  return lock.withLock(`vote:${userId}`, async () => {
    const last = await CommunityVote.findOne({ where: { communityId: row.id, userId }, order: [['id', 'DESC']] });
    if (last && Date.now() - new Date(last.createdAt).getTime() < VOTE_EVERY) {
      const next = new Date(new Date(last.createdAt).getTime() + VOTE_EVERY);
      throw new CommunityError(`Вы уже голосовали. Снова — после ${next.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`);
    }
    const h = ipHash(ip);
    if (h && (await CommunityVote.count({ where: { ipHash: h, createdAt: { [Op.gt]: new Date(Date.now() - 3600000) } } })) >= IP_VOTES_PER_HOUR) throw new CommunityError('Слишком много голосов из этой сети. Попробуйте позже.');
    await CommunityVote.create({ communityId: row.id, userId, ipHash: h });
    await countStat(row.id, 'votes');
    return row.reload();
  });
}

async function report(communityId, userId, reason) {
  const { Community, CommunityReport } = db();
  const row = await Community.findByPk(Number(communityId));
  if (!row) throw new CommunityError('Сообщество не найдено.');
  const text = String(reason || '').trim().slice(0, 500);
  if (text.length < 10) throw new CommunityError('Опишите проблему хотя бы в 10 символах.');
  const [, created] = await CommunityReport.findOrCreate({ where: { communityId: row.id, userId }, defaults: { reason: text } });
  if (!created) throw new CommunityError('Вы уже жаловались на это сообщество.');
  return true;
}

// ---- the catalog ----
/** Live numbers from the bot (members, icon) when it is on that server. */
function liveOf(c) {
  const g = client()?.guilds?.cache?.get(c.guildId);
  return { memberCount: g?.memberCount ?? c.memberCount, iconHash: g ? g.icon : c.iconHash };
}

/**
 * The catalog page: published listings filtered by text and category, sorted; pinned ones always first, bumped ones next
 * (for «Популярные»). Returns { items, total, page, pages, featured }.
 */
async function catalog({ q = '', category = '', sort = 'popular', page = 1 } = {}) {
  const { Community, CommunityVote } = db();
  let rows = await Community.findAll({ where: { status: 'published' }, raw: true });
  const query = String(q || '').trim().toLowerCase().slice(0, 60);
  if (query) rows = rows.filter((c) => `${c.name} ${c.shortDesc} ${c.tags}`.toLowerCase().includes(query));
  if (CATEGORY[category]) rows = rows.filter((c) => listOf(c.categories).includes(category));
  const ids = rows.map((c) => c.id);
  const promos = await activePromos(ids.length ? ids : [-1]);
  const recent = ids.length ? await CommunityVote.findAll({ where: { communityId: { [Op.in]: ids }, createdAt: { [Op.gt]: new Date(Date.now() - 30 * 86400000) } }, attributes: ['communityId'], raw: true }) : [];
  const votes30 = new Map();
  for (const v of recent) votes30.set(v.communityId, (votes30.get(v.communityId) || 0) + 1);
  const items = rows.map((c) => {
    const live = liveOf(c);
    const pr = promos.get(c.id) || {};
    return { ...c, ...live, icon: iconUrl({ ...c, ...live }), cats: listOf(c.categories), tagList: listOf(c.tags), votes30: votes30.get(c.id) || 0, promo: pr, pinned: Boolean(pr.pin), bumped: Boolean(pr.bump), highlighted: Boolean(pr.highlight), featured: Boolean(pr.featured) };
  });
  const key = {
    popular: (c) => [c.pinned ? 1 : 0, c.bumped ? new Date(c.bumpedAt || 0).getTime() : 0, c.votes30 * 10 + Math.log10(1 + c.memberCount)],
    votes: (c) => [c.pinned ? 1 : 0, 0, c.votes],
    members: (c) => [c.pinned ? 1 : 0, 0, c.memberCount],
    new: (c) => [c.pinned ? 1 : 0, 0, new Date(c.publishedAt || c.createdAt).getTime()]
  }[SORTS[sort] ? sort : 'popular'];
  items.sort((a, b) => { const x = key(a); const y = key(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.id - b.id; });
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const p = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
  const featured = query || category || p > 1 ? [] : items.filter((c) => c.featured).slice(0, 4);
  return { items: items.slice((p - 1) * PER_PAGE, p * PER_PAGE), total: items.length, page: p, pages, featured };
}

/** One community for its page (published, or any status for its own admins / the platform). */
async function one(id) {
  const c = await db().Community.findByPk(Number(id), { raw: true });
  if (!c) return null;
  const live = liveOf(c);
  const promo = (await activePromos([c.id])).get(c.id) || {};
  return { ...c, ...live, icon: iconUrl({ ...c, ...live }), cats: listOf(c.categories), tagList: listOf(c.tags), promo, highlighted: Boolean(promo.highlight) };
}

/** Statistics for the owner: the last 30 days by day, promotions bought. */
async function statsOf(communityId) {
  const { CommunityStat, CommunityPromotion } = db();
  const since = day(new Date(Date.now() - 29 * 86400000));
  const rows = await CommunityStat.findAll({ where: { communityId, day: { [Op.gte]: since } }, order: [['day', 'ASC']], raw: true });
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = Array.from({ length: 30 }, (_, i) => { const d = day(new Date(Date.now() - (29 - i) * 86400000)); const r = byDay.get(d) || {}; return { day: d, views: r.views || 0, clicks: r.clicks || 0, votes: r.votes || 0 }; });
  const promotions = await CommunityPromotion.findAll({ where: { communityId }, order: [['id', 'DESC']], limit: 30, raw: true });
  return { series, promotions };
}

module.exports = {
  CommunityError, CATEGORIES, CATEGORY, PROMOS, DAYS, SORTS, PER_PAGE, BANNER_HOSTS, VOTE_EVERY,
  platform, setPlatform, cleanFields, cleanInvite, save, setVisible, remove, moderate, activePromos, buy, view, click, vote, report, catalog, one, statsOf, iconUrl, accountAge, listOf
};
