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

// Line icons of the catalog (24-unit drawings, stroke = currentColor), with a colour of each category — instead of emoji,
// which look different on every system. icon(name, size) gives an inline <svg>; the page colours it with --ic.
const ICON_PATHS = {
  gaming: '<path d="M6.5 7.5h11A4.5 4.5 0 0 1 22 12v.5a4 4 0 0 1-7.2 2.4L14 14h-4l-.8.9A4 4 0 0 1 2 12.5V12a4.5 4.5 0 0 1 4.5-4.5Z"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="16" cy="11" r=".6" fill="currentColor"/><circle cx="17.8" cy="12.8" r=".6" fill="currentColor"/>',
  social: '<path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
  anime: '<path d="M12 3.5 13.9 9l5.6.4-4.3 3.6 1.4 5.5L12 15.5l-4.6 3 1.4-5.5-4.3-3.6L10.1 9Z"/>',
  music: '<path d="M9 18.5V5.5l11-2v13"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="16.5" r="2.5"/>',
  art: '<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor"/><circle cx="10" cy="7.5" r="1" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor"/>',
  tech: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m9 8.5-2 1.8 2 1.7M15 8.5l2 1.8-2 1.7"/>',
  study: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5Z"/>',
  rp: '<path d="M4 6c2.7 1 5.3 1 8 0s5.3-1 8 0v5a8 8 0 0 1-16 0Z"/><path d="M8.5 11h.01M15.5 11h.01M9.5 15c1.5 1 3.5 1 5 0"/>',
  memes: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>',
  sport: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11M12 14v3.5M8.5 20.5h7M9.5 17.5h5"/>',
  crypto: '<path d="M3.5 17.5 9 12l3.5 3.5 8-8"/><path d="M15 7.5h5.5V13"/>',
  other: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  all: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  members: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.3a5 5 0 0 1 3 4.7v1"/>',
  vote: '<path d="M12 4.5 20 13h-4.5v6.5h-7V13H4Z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5h-11L10 8.5Z"/><path d="M12 12v8.5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z"/>',
  views: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  clicks: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  star: '<path d="M12 3.5 14.6 9l5.9.6-4.4 4 1.3 5.9L12 16.6l-5.4 2.9 1.3-5.9-4.4-4 5.9-.6Z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  online: '<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8.5"/>',
  boost: '<path d="M12 3 18.5 7v10L12 21l-6.5-4V7Z"/><path d="M12 8v8M9 11l3-3 3 3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  rules: '<path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v15.5l-6.5-3-6.5 3V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M9 8.5h6M9 12h4"/>',
  trend: '<path d="M3.5 17 9 11.5l3.5 3.5 8-8"/><path d="M15 7h5.5v5.5"/>'
};
const CATEGORY_HUE = { gaming: '#8f8cff', social: '#5fb8f0', anime: '#f08cc4', music: '#c38cf0', art: '#f0b04a', tech: '#5fd0c0', study: '#7fb36a', rp: '#e08a6a', memes: '#f0d24a', sport: '#6ad08f', crypto: '#4ad0a0', other: '#a0a6ba', all: '#b3adff' };
function icon(name, size = 16) {
  const body = ICON_PATHS[name] || ICON_PATHS.other;
  return `<svg class="cm-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
const hue = (k) => CATEGORY_HUE[k] || CATEGORY_HUE.other;
const PROMOS = {
  bump: { label: 'Поднятие', desc: 'Сообщество поднимается в начало каталога (после закреплённых) на сутки.', perDay: false, def: 50 },
  pin: { label: 'Закрепление', desc: 'Карточка стоит в самом верху каталога, над всеми остальными.', perDay: true, def: 300 },
  highlight: { label: 'Выделение', desc: 'Карточка выделена цветной рамкой и значком в каталоге.', perDay: true, def: 100 },
  featured: { label: 'Рекомендации', desc: 'Сообщество показывается в блоке «Рекомендуем» над каталогом.', perDay: true, def: 200 }
};
const DAYS = [1, 3, 7, 14, 30];
const SORTS = { popular: 'Популярные', trending: 'Растущие', rating: 'По оценкам', votes: 'По голосам', members: 'По участникам', new: 'Новые' };
const SIZES = { s: ['До 100 участников', 0, 99], m: ['100–1 000', 100, 1000], l: ['Больше 1 000', 1001, Infinity] };
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
  // pre-moderation is ON until the platform owner switches it off: a new listing waits for a look before it is shown
  return { prices, premoderation: o.premoderation !== '0' };
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
  const rules = String(b.rules || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim().slice(0, 200)).filter(Boolean).slice(0, 20).join('\n') || null;
  // links: up to four, https only, with a short label of their own
  const labels = [].concat(b.linkLabel || []); const urls = [].concat(b.linkUrl || []);
  const links = [];
  urls.forEach((raw, i) => {
    const url = String(raw || '').trim(); if (!url) return;
    let u; try { u = new URL(url); } catch { throw new CommunityError(`Ссылка «${url.slice(0, 40)}» некорректна.`); }
    if (u.protocol !== 'https:' || url.length > 200) throw new CommunityError('Ссылки — только https://, до 200 символов.');
    links.push({ label: String(labels[i] || '').trim().slice(0, 30) || u.hostname.replace(/^www\./, ''), url: u.href });
  });
  if (links.length > 4) throw new CommunityError('Не больше четырёх ссылок.');
  // pictures: our own addresses (uploaded before) or links that save() downloads and keeps (see communityMedia.js)
  const shots = String(b.gallery || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  if (shots.length > 6) throw new CommunityError('Не больше шести скриншотов.');
  const picture = (x, what) => { if (require('./communityMedia').isLocal(x) || /^https:\/\/\S{1,1500}$/.test(x)) return x; throw new CommunityError(`${what}: нужна ссылка https:// или загруженный файл.`); };
  const gallery = shots.map((x, i) => picture(x, `Скриншот ${i + 1}`));
  const banner = String(b.bannerUrl || '').trim() ? picture(String(b.bannerUrl).trim(), 'Баннер') : null;
  const notifyChannelId = /^\d{15,25}$/.test(String(b.notifyChannelId || '')) ? String(b.notifyChannelId) : null;
  return { name, shortDesc, description, categories: cats.join(','), tags: tags.join(','), inviteUrl: cleanInvite(b.inviteUrl), bannerUrl: banner,
    rules, links: links.length ? JSON.stringify(links) : null, gallery: gallery.length ? JSON.stringify(gallery) : null, notifyChannelId };
}

/**
 * The invite is asked from Discord: it must lead to THIS server (an admin of one server can no longer list his card with a
 * link to another one). Returns { name } — the server's real name from Discord, or null when Discord did not give it.
 * Throws a CommunityError a person can act on.
 */
async function verifyInvite(inviteUrl, guildId) {
  const code = /\/([A-Za-z0-9-]{2,32})$/.exec(inviteUrl)?.[1];
  let inv = null;
  try {
    const c = client();
    if (c?.fetchInvite) { const x = await c.fetchInvite(code); inv = { guildId: x?.guild?.id || x?.guildId || null, name: x?.guild?.name || null }; } else {
      const { data } = await require('../../web/discordApi').botApi.get(`/invites/${code}`);
      inv = { guildId: data?.guild?.id || data?.guild_id || null, name: data?.guild?.name || null };
    }
  } catch (err) {
    const gone = require('../utils/discordErrors').isGone(err) || err?.code === 10006 || err?.rawError?.code === 10006 || err?.response?.data?.code === 10006;
    throw new CommunityError(gone ? 'Это приглашение недействительно или истекло. Создайте в Discord бессрочное приглашение и вставьте его.' : 'Не удалось проверить приглашение у Discord. Попробуйте ещё раз через минуту.');
  }
  if (!inv?.guildId || inv.guildId !== String(guildId)) throw new CommunityError('Приглашение ведёт на другой сервер. Вставьте приглашение именно на этот сервер.');
  return { name: inv.name };
}

/** Adds or updates the server's listing. A blocked one stays blocked; with pre-moderation a new one waits. */
async function save(guildId, userId, body) {
  const { Community } = db();
  const fields = cleanFields(body);
  const real = await api.verifyInvite(fields.inviteUrl, guildId);
  if (real.name) fields.name = real.name.slice(0, 60); // the name comes from Discord, like the icon
  // pictures are kept by the bot: a link from Discord would stop working in a day
  const media = require('./communityMedia');
  const kept = async (ref, what) => { try { return await media.keep(String(guildId), ref); } catch (e) { if (e instanceof media.MediaError) throw new CommunityError(`${what}: ${e.message}`); throw e; } };
  if (fields.bannerUrl) fields.bannerUrl = await kept(fields.bannerUrl, 'Баннер');
  const shots = jsonList(fields.gallery);
  const keptShots = [];
  for (let i = 0; i < shots.length; i++) keptShots.push(await kept(shots[i], `Скриншот ${i + 1}`));
  fields.gallery = keptShots.length ? JSON.stringify([...new Set(keptShots)]) : null;
  const before = await db().Community.findOne({ where: { guildId: String(guildId) }, attributes: ['bannerUrl', 'gallery'], raw: true });
  const was = before ? [before.bannerUrl, ...jsonList(before.gallery)].filter(Boolean) : [];
  const tidy = () => media.prune(String(guildId), [fields.bannerUrl, ...keptShots].filter(Boolean), was).catch(() => {});
  const g = client()?.guilds?.cache?.get(String(guildId));
  const live = g ? { iconHash: g.icon || null, memberCount: g.memberCount || 0 } : {};
  const row = await Community.findOne({ where: { guildId: String(guildId) } });
  if (row) {
    if (row.status === 'blocked') throw new CommunityError('Сообщество заблокировано модерацией платформы — изменить его нельзя.');
    await row.update({ ...fields, ...live });
    await tidy();
    return row;
  }
  const { premoderation } = await platform();
  const created = await Community.create({ guildId: String(guildId), ownerId: userId, ...fields, ...live, status: premoderation ? 'pending' : 'published', publishedAt: premoderation ? null : new Date() });
  await coins().checkQuests(created).catch(() => {}); // «опубликовать сообщество» — a one-time DARK Coins quest
  await tidy();
  return created;
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
  const { Community, CommunityVote, CommunityStat, CommunityReport, CommunityReview, CommunityReviewReport, CommunityFavorite, inTransaction } = db();
  const row = await Community.findOne({ where: { guildId: String(guildId) } });
  if (!row) return false;
  if (row.status === 'blocked') throw new CommunityError('Заблокированное сообщество удалить нельзя — напишите модерации платформы.');
  await inTransaction(async (t) => {
    const reviewIds = (await CommunityReview.findAll({ where: { communityId: row.id }, attributes: ['id'], raw: true, transaction: t })).map((r) => r.id);
    if (reviewIds.length) await CommunityReviewReport.destroy({ where: { reviewId: reviewIds }, transaction: t });
    for (const M of [CommunityVote, CommunityStat, CommunityReport, CommunityReview, CommunityFavorite]) await M.destroy({ where: { communityId: row.id }, transaction: t });
    await row.destroy({ transaction: t });
  });
  await require('./communityMedia').prune(String(guildId), []).catch(() => {});
  return true;
}

/** Platform moderation: publish, hide or block, with a note the owner sees. */
async function moderate(actorId, communityId, status, note = '') {
  if (!coins().isPlatformOwner(actorId)) throw new CommunityError('Это может только модерация платформы.');
  if (!['published', 'hidden', 'blocked'].includes(status)) throw new CommunityError('Неизвестное действие.');
  const row = await db().Community.findByPk(Number(communityId));
  if (!row) throw new CommunityError('Сообщество не найдено.');
  await row.update({ status, moderationNote: String(note || '').slice(0, 300) || null, publishedAt: status === 'published' && !row.publishedAt ? new Date() : row.publishedAt });
  await coins().checkQuests(row).catch(() => {});
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
async function buy(guildId, buyerId, kind, days, opKey, from = 'me') {
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
    // paid from the buyer's own wallet, or from the server's (filled by the server's rewards)
    const payer = from === 'server' ? coins().guildWallet(row.guildId) : buyerId;
    const { tx, duplicate } = await coins().charge(payer, price, { kind: 'promo', opKey: key, actorId: buyerId, note: `${p.label} · ${row.name}${p.perDay ? ` · ${d} дн.` : ''}` }, t);
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

/** «Присоединиться» pressed by a signed-in person: if the bot then sees him join, the server is rewarded (darkCoins.onMemberJoined). */
async function joinIntent(c, userId, ip) {
  if (!userId) return;
  const { CommunityJoin } = db();
  const [row, created] = await CommunityJoin.findOrCreate({ where: { guildId: c.guildId, userId: String(userId) }, defaults: { ipHash: ipHash(ip), clickedAt: new Date() } });
  if (!created && !row.joinedAt) await row.update({ clickedAt: new Date(), ipHash: ipHash(ip) });
}

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
      // how long is left, in words — a clock time alone was read in the wrong time zone
      const left = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 60000));
      const h = Math.floor(left / 60); const m = left % 60;
      const wait = h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
      throw new CommunityError(`Вы уже голосовали за это сообщество. Снова можно через ${wait} (в ${next.toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })} по Москве).`);
    }
    const h = ipHash(ip);
    if (h && (await CommunityVote.count({ where: { ipHash: h, createdAt: { [Op.gt]: new Date(Date.now() - 3600000) } } })) >= IP_VOTES_PER_HOUR) throw new CommunityError('Слишком много голосов из этой сети. Попробуйте позже.');
    const v = await CommunityVote.create({ communityId: row.id, userId, ipHash: h });
    await countStat(row.id, 'votes');
    await coins().onVote(userId, row.id, v.id).catch(() => {}); // a small DARK Coins reward for the voter (a few a day)
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

const rating = (c) => (c.ratingCount ? Math.round((c.ratingSum / c.ratingCount) * 10) / 10 : null);
// for sorting by marks: a few reviews do not outweigh many (the average pulled towards 3.5 by five imaginary reviews)
const ratingScore = (c) => (5 * 3.5 + (c.ratingSum || 0)) / (5 + (c.ratingCount || 0));
const jsonList = (v) => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

/** Activity of the last 7 days by community: { votes, clicks, views } — for «Растущие». Kept for a minute. */
let weekCache = { at: 0, map: new Map() };
async function weekActivity() {
  if (Date.now() - weekCache.at < 60000) return weekCache.map;
  const since = day(new Date(Date.now() - 6 * 86400000));
  const rows = await db().CommunityStat.findAll({ where: { day: { [Op.gte]: since } }, raw: true });
  const map = new Map();
  for (const r of rows) {
    const o = map.get(r.communityId) || { votes: 0, clicks: 0, views: 0 };
    o.votes += r.votes || 0; o.clicks += r.clicks || 0; o.views += r.views || 0;
    map.set(r.communityId, o);
  }
  weekCache = { at: Date.now(), map };
  return map;
}
const trendOf = (w) => (w ? w.votes * 3 + w.clicks * 2 + w.views * 0.1 : 0);

/**
 * The catalog page: published listings filtered by text, category, tag, size, rating and favourites, sorted; pinned ones
 * always first, bumped ones next (for «Популярные»). Returns { items, total, page, pages, featured, trending }.
 */
async function catalog({ q = '', category = '', sort = 'popular', page = 1, tag = '', size = '', minRating = 0, favIds = null } = {}) {
  const { Community, CommunityVote } = db();
  let rows = await Community.findAll({ where: { status: 'published' }, raw: true });
  const all = rows;
  const query = String(q || '').trim().toLowerCase().slice(0, 60);
  const tg = String(tag || '').trim().toLowerCase().slice(0, 20);
  if (query) rows = rows.filter((c) => `${c.name} ${c.shortDesc} ${c.tags}`.toLowerCase().includes(query));
  if (CATEGORY[category]) rows = rows.filter((c) => listOf(c.categories).includes(category));
  if (tg) rows = rows.filter((c) => listOf(c.tags).includes(tg));
  if (favIds) rows = rows.filter((c) => favIds.has(c.id));
  if (minRating) rows = rows.filter((c) => (rating(c) || 0) >= minRating);
  const ids = all.map((c) => c.id);
  const promos = await activePromos(ids.length ? ids : [-1]);
  const recent = ids.length ? await CommunityVote.findAll({ where: { communityId: { [Op.in]: ids }, createdAt: { [Op.gt]: new Date(Date.now() - 30 * 86400000) } }, attributes: ['communityId'], raw: true }) : [];
  const votes30 = new Map();
  for (const v of recent) votes30.set(v.communityId, (votes30.get(v.communityId) || 0) + 1);
  const week = await weekActivity();
  const shape = (c) => {
    const live = liveOf(c);
    const pr = promos.get(c.id) || {};
    return { ...c, ...live, icon: iconUrl({ ...c, ...live }), cats: listOf(c.categories), tagList: listOf(c.tags), votes30: votes30.get(c.id) || 0, trend: trendOf(week.get(c.id)), rating: rating(c),
      promo: pr, pinned: Boolean(pr.pin), bumped: Boolean(pr.bump), highlighted: Boolean(pr.highlight), featured: Boolean(pr.featured), fav: Boolean(favIds && favIds.has(c.id)) };
  };
  let items = rows.map(shape);
  if (SIZES[size]) items = items.filter((c) => c.memberCount >= SIZES[size][1] && c.memberCount <= SIZES[size][2]);
  const key = {
    popular: (c) => [c.pinned ? 1 : 0, c.bumped ? new Date(c.bumpedAt || 0).getTime() : 0, c.votes30 * 10 + Math.log10(1 + c.memberCount)],
    trending: (c) => [c.pinned ? 1 : 0, 0, c.trend],
    rating: (c) => [c.pinned ? 1 : 0, 0, ratingScore(c)],
    votes: (c) => [c.pinned ? 1 : 0, 0, c.votes],
    members: (c) => [c.pinned ? 1 : 0, 0, c.memberCount],
    new: (c) => [c.pinned ? 1 : 0, 0, new Date(c.publishedAt || c.createdAt).getTime()]
  }[SORTS[sort] ? sort : 'popular'];
  items.sort((a, b) => { const x = key(a); const y = key(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.id - b.id; });
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const p = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
  const front = !query && !CATEGORY[category] && !tg && !favIds && !minRating && !SIZES[size] && p === 1;
  const featured = front ? items.filter((c) => c.featured).slice(0, 4) : [];
  // «Растущие на этой неделе»: the most active of the week (not the same as «Рекомендуем»)
  let trending = front && sort !== 'trending' ? all.map(shape).filter((c) => c.trend > 0 && !c.featured).sort((a, b) => b.trend - a.trend).slice(0, 4) : [];
  if (trending.length < 2) trending.length = 0; // one alone is not a «row»
  return { items: items.slice((p - 1) * PER_PAGE, p * PER_PAGE), total: items.length, page: p, pages, featured, trending };
}

/** One community for its page (published, or any status for its own admins / the platform). */
async function one(id) {
  const c = await db().Community.findByPk(Number(id), { raw: true });
  if (!c) return null;
  const live = liveOf(c);
  const promo = (await activePromos([c.id])).get(c.id) || {};
  return { ...c, ...live, icon: iconUrl({ ...c, ...live }), cats: listOf(c.categories), tagList: listOf(c.tags), promo, highlighted: Boolean(promo.highlight),
    rating: rating(c), linkList: jsonList(c.links), galleryList: jsonList(c.gallery), ruleList: String(c.rules || '').split('\n').filter(Boolean) };
}

// Live numbers of the server's page: online (asked from Discord at most once in ten minutes) and boosts.
const onlineCache = new Map();
async function liveExtra(c) {
  const g = client()?.guilds?.cache?.get(c.guildId);
  if (!g) return { online: null, boosts: null, tier: null };
  let hit = onlineCache.get(c.guildId);
  if (!hit || Date.now() - hit.at > 600000) {
    const fresh = await g.client.guilds.fetch({ guild: g.id, withCounts: true, force: true }).catch(() => null);
    hit = { at: Date.now(), online: fresh?.approximatePresenceCount ?? null };
    if (onlineCache.size > 5000) onlineCache.clear();
    onlineCache.set(c.guildId, hit);
  }
  return { online: hit.online, boosts: g.premiumSubscriptionCount || 0, tier: g.premiumTier || 0 };
}

/** Up to `n` published communities like this one: sharing a category, the most voted for first. */
async function similar(c, n = 4) {
  const mine = new Set(listOf(c.categories));
  if (!mine.size) return [];
  const rows = await db().Community.findAll({ where: { status: 'published', id: { [Op.ne]: c.id } }, raw: true });
  return rows.map((r) => ({ r, common: listOf(r.categories).filter((k) => mine.has(k)).length }))
    .filter((x) => x.common > 0)
    .sort((a, b) => b.common - a.common || b.r.votes - a.r.votes)
    .slice(0, n)
    .map(({ r }) => { const live = liveOf(r); return { ...r, ...live, icon: iconUrl({ ...r, ...live }), rating: rating(r) }; });
}

// ---- favourites ----
async function favoriteIds(userId) {
  if (!userId) return new Set();
  const rows = await db().CommunityFavorite.findAll({ where: { userId: String(userId) }, attributes: ['communityId'], raw: true });
  return new Set(rows.map((r) => r.communityId));
}
/** Adds to «Избранное» or removes from it; returns whether it is there now. */
async function toggleFavorite(userId, communityId) {
  const { CommunityFavorite, Community } = db();
  const c = await Community.findByPk(Number(communityId));
  if (!c || c.status !== 'published') throw new CommunityError('Сообщество не найдено.');
  const gone = await CommunityFavorite.destroy({ where: { userId: String(userId), communityId: c.id } });
  if (gone) return false;
  if ((await CommunityFavorite.count({ where: { userId: String(userId) } })) >= 200) throw new CommunityError('В избранном уже 200 сообществ — уберите лишние.');
  await CommunityFavorite.findOrCreate({ where: { userId: String(userId), communityId: c.id } });
  return true;
}

// ---- reviews ----
const REVIEW_MIN_STAY = 24 * 3600 * 1000;
/** Who may review: a Discord account older than 7 days, on the server for a day at least, not its owner. */
async function mayReview(c, userId) {
  if (accountAge(userId) < MIN_ACCOUNT_AGE) throw new CommunityError('Оставить отзыв можно с аккаунта Discord старше 7 дней.');
  if (String(c.ownerId) === String(userId)) throw new CommunityError('Свой сервер оценивать нельзя.');
  const g = client()?.guilds?.cache?.get(c.guildId);
  if (!g) throw new CommunityError('Сейчас нельзя проверить, что вы участник сервера. Попробуйте позже.');
  if (g.ownerId === String(userId)) throw new CommunityError('Свой сервер оценивать нельзя.');
  const m = await g.members.fetch(String(userId)).catch(() => null);
  if (!m) throw new CommunityError('Отзыв могут оставить только участники сервера — сначала присоединитесь.');
  if (m.joinedTimestamp && Date.now() - m.joinedTimestamp < REVIEW_MIN_STAY) throw new CommunityError('Отзыв можно оставить через сутки после входа на сервер.');
}

/** Writes (or changes) the person's review; the marks of the community change in the same transaction. */
async function saveReview(communityId, userId, { rating: r, text }) {
  const { Community, CommunityReview, inTransaction } = db();
  const c = await Community.findByPk(Number(communityId));
  if (!c || c.status !== 'published') throw new CommunityError('Сообщество не найдено.');
  const mark = Math.trunc(Number(r));
  if (!(mark >= 1 && mark <= 5)) throw new CommunityError('Поставьте оценку от 1 до 5 звёзд.');
  const body = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
  if (body && body.length < 10) throw new CommunityError('Отзыв — хотя бы 10 символов, или оставьте только оценку.');
  await mayReview(c, userId);
  let isNew = false;
  const review = await inTransaction(async (t) => {
    const was = await CommunityReview.findOne({ where: { communityId: c.id, userId: String(userId) }, transaction: t });
    if (was) {
      if (was.status === 'published') await Community.increment({ ratingSum: mark - was.rating }, { where: { id: c.id }, transaction: t });
      await was.update({ rating: mark, text: body }, { transaction: t });
      return was;
    }
    isNew = true;
    const row = await CommunityReview.create({ communityId: c.id, userId: String(userId), rating: mark, text: body }, { transaction: t });
    await Community.increment({ ratingSum: mark, ratingCount: 1 }, { where: { id: c.id }, transaction: t });
    return row;
  });
  if (isNew) notifyReview(c, review).catch(() => {});
  return review;
}

async function deleteReview(communityId, userId) {
  const { Community, CommunityReview, CommunityReviewReport, inTransaction } = db();
  return inTransaction(async (t) => {
    const r = await CommunityReview.findOne({ where: { communityId: Number(communityId), userId: String(userId) }, transaction: t });
    if (!r) return false;
    if (r.status === 'published') await Community.increment({ ratingSum: -r.rating, ratingCount: -1 }, { where: { id: r.communityId }, transaction: t });
    await CommunityReviewReport.destroy({ where: { reviewId: r.id }, transaction: t });
    await r.destroy({ transaction: t });
    return true;
  });
}

/** The server's admins answer a review of their community (an empty text removes the answer). */
async function replyReview(guildId, reviewId, actorId, text) {
  const { Community, CommunityReview } = db();
  const c = await Community.findOne({ where: { guildId: String(guildId) } });
  const r = c ? await CommunityReview.findByPk(Number(reviewId)) : null;
  if (!r || r.communityId !== c.id) throw new CommunityError('Отзыв не найден.');
  const body = String(text || '').trim().slice(0, 600);
  await r.update(body ? { reply: body, replyBy: String(actorId), replyAt: new Date() } : { reply: null, replyBy: null, replyAt: null });
  return r;
}

async function reportReview(reviewId, userId, reason) {
  const { CommunityReview, CommunityReviewReport } = db();
  const r = await CommunityReview.findByPk(Number(reviewId));
  if (!r || r.status !== 'published') throw new CommunityError('Отзыв не найден.');
  const text = String(reason || '').trim().slice(0, 300);
  if (text.length < 5) throw new CommunityError('Опишите, что не так с отзывом.');
  const [, created] = await CommunityReviewReport.findOrCreate({ where: { reviewId: r.id, userId: String(userId) }, defaults: { reason: text } });
  if (!created) throw new CommunityError('Вы уже жаловались на этот отзыв.');
  await r.increment({ reports: 1 });
  return true;
}

/** Platform moderation of a review: hide (it stops counting), restore, or dismiss the complaints. */
async function moderateReview(actorId, reviewId, action) {
  if (!coins().isPlatformOwner(actorId)) throw new CommunityError('Это может только модерация платформы.');
  const { Community, CommunityReview, CommunityReviewReport, inTransaction } = db();
  return inTransaction(async (t) => {
    const r = await CommunityReview.findByPk(Number(reviewId), { transaction: t });
    if (!r) throw new CommunityError('Отзыв не найден.');
    if (action === 'hide' && r.status === 'published') {
      await Community.increment({ ratingSum: -r.rating, ratingCount: -1 }, { where: { id: r.communityId }, transaction: t });
      await r.update({ status: 'hidden' }, { transaction: t });
    } else if (action === 'restore' && r.status === 'hidden') {
      await Community.increment({ ratingSum: r.rating, ratingCount: 1 }, { where: { id: r.communityId }, transaction: t });
      await r.update({ status: 'published', reports: 0 }, { transaction: t });
      await CommunityReviewReport.destroy({ where: { reviewId: r.id }, transaction: t });
    } else if (action === 'dismiss') {
      await r.update({ reports: 0 }, { transaction: t });
      await CommunityReviewReport.destroy({ where: { reviewId: r.id }, transaction: t });
    } else throw new CommunityError('Неизвестное действие.');
    return r;
  });
}

const REVIEWS_PER_PAGE = 10;
/** Reviews of a community for its page: newest first, the person's own on top; marks by star for the bars. */
async function reviewsOf(communityId, { page = 1, userId = null, all = false } = {}) {
  const { CommunityReview } = db();
  const where = { communityId: Number(communityId) };
  if (!all) where.status = 'published';
  const total = await CommunityReview.count({ where });
  const pages = Math.max(1, Math.ceil(total / REVIEWS_PER_PAGE));
  const p = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
  const items = await CommunityReview.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: REVIEWS_PER_PAGE, offset: (p - 1) * REVIEWS_PER_PAGE, raw: true });
  const marks = await CommunityReview.findAll({ where: { communityId: Number(communityId), status: 'published' }, attributes: ['rating'], raw: true });
  const dist = [0, 0, 0, 0, 0];
  for (const m of marks) if (m.rating >= 1 && m.rating <= 5) dist[m.rating - 1]++;
  const mine = userId ? await CommunityReview.findOne({ where: { communityId: Number(communityId), userId: String(userId) }, raw: true }) : null;
  return { items, total, page: p, pages, dist, mine };
}

/** A new review is told about in the channel the server chose (Dashboard → «Сообщество в каталоге»). */
async function notifyReview(c, review) {
  if (!c.notifyChannelId) return;
  const g = client()?.guilds?.cache?.get(c.guildId);
  const ch = g?.channels?.cache?.get(c.notifyChannelId);
  if (!ch?.send) return;
  const { EmbedBuilder } = require('discord.js');
  const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  const e = new EmbedBuilder().setColor(0xf0b132).setTitle(`Новый отзыв о сервере: ${stars}`).setDescription(`${review.text ? review.text.slice(0, 600) : '*Без текста — только оценка.*'}\n\n— <@${review.userId}>`);
  if (base) e.setURL(`${base}/communities/${c.id}#reviews`).setFooter({ text: 'Ответить можно в панели: «Сообщество в каталоге»' });
  await ch.send({ embeds: [e], allowedMentions: { parse: [] } });
}

// ---- voting from Discord (/vote) ----
/** The published listing of a server, or null. */
async function forGuild(guildId) {
  const row = await db().Community.findOne({ where: { guildId: String(guildId), status: 'published' }, raw: true });
  return row ? one(row.id) : null;
}
/** «Напомнить» after a vote: a direct message when voting is possible again (once; a second press changes nothing). */
async function remindVote(communityId, userId) {
  const { CommunityVote, Reminder, Community } = db();
  const c = await Community.findByPk(Number(communityId));
  if (!c) throw new CommunityError('Сообщество не найдено.');
  const last = await CommunityVote.findOne({ where: { communityId: c.id, userId: String(userId) }, order: [['id', 'DESC']] });
  const at = new Date((last ? new Date(last.createdAt).getTime() : Date.now()) + VOTE_EVERY);
  const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const text = `Можно снова проголосовать за «${c.name}»: ${base ? `${base}/communities/${c.id}` : 'команда /vote на сервере'}`.slice(0, 250);
  const [, created] = await Reminder.findOrCreate({ where: { userId: String(userId), text }, defaults: { guildId: null, channelId: null, remindAt: at } });
  return { at, created };
}

/** Statistics for the owner: the last 30 days by day, promotions bought. */
async function statsOf(communityId) {
  const { CommunityStat, CommunityPromotion } = db();
  const since = day(new Date(Date.now() - 29 * 86400000));
  const rows = await CommunityStat.findAll({ where: { communityId, day: { [Op.gte]: since } }, order: [['day', 'ASC']], raw: true });
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = Array.from({ length: 30 }, (_, i) => { const d = day(new Date(Date.now() - (29 - i) * 86400000)); const r = byDay.get(d) || {}; return { day: d, views: r.views || 0, clicks: r.clicks || 0, votes: r.votes || 0 }; });
  const { CommunityReview, CommunityFavorite } = db();
  const [newReviews, favorites] = await Promise.all([
    CommunityReview.count({ where: { communityId, createdAt: { [Op.gte]: new Date(Date.now() - 30 * 86400000) } } }),
    CommunityFavorite.count({ where: { communityId } })
  ]);
  const promotions = await CommunityPromotion.findAll({ where: { communityId }, order: [['id', 'DESC']], limit: 30, raw: true });
  return { series, promotions, newReviews, favorites };
}

// ---- pictures saved before the bot kept them: links from Discord are taken in once (dead ones are dropped) ----
async function adoptOldPictures() {
  const { Community } = db();
  const media = require('./communityMedia');
  const rows = await Community.findAll({ where: { [Op.or]: [{ bannerUrl: { [Op.like]: 'https://%' } }, { gallery: { [Op.like]: '%https://%' } }] } });
  let moved = 0;
  for (const row of rows) {
    const take = async (u) => {
      if (!u || media.isLocal(u)) return u;
      try { moved++; return await media.keep(row.guildId, u); } catch (e) { return e instanceof media.MediaError && /устарела|только с/.test(e.message) ? null : u; }
    };
    const banner = await take(row.bannerUrl);
    const shots = (await Promise.all(jsonList(row.gallery).map(take))).filter(Boolean);
    await row.update({ bannerUrl: banner, gallery: shots.length ? JSON.stringify([...new Set(shots)]) : null });
  }
  return moved;
}

// ---- buttons of /vote ----
const isCommunityButton = (i) => i.isButton?.() && /^cm(vote|remind):\d+$/.test(i.customId || '');
async function handleCommunityButton(interaction) {
  const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const embeds = require('../utils/embeds');
  const [kind, id] = interaction.customId.split(':');
  try {
    if (kind === 'cmvote') {
      const row = await vote(id, interaction.user.id, null);
      const again = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cmremind:${id}`).setLabel('Напомнить через 12 ч').setEmoji('⏰').setStyle(ButtonStyle.Secondary));
      return interaction.reply({ embeds: [embeds.success(`Голос за «${row.name}» учтён — спасибо! Теперь голосов: ${Number(row.votes).toLocaleString('ru-RU')}.`)], components: [again], flags: MessageFlags.Ephemeral });
    }
    const { at, created } = await remindVote(id, interaction.user.id);
    return interaction.reply({ embeds: [embeds.success(created ? `Напомню в личные сообщения <t:${Math.floor(at / 1000)}:R>.` : 'Напоминание уже стоит.')], flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (!(e instanceof CommunityError)) throw e;
    return interaction.reply({ embeds: [embeds.error(e.message)], flags: MessageFlags.Ephemeral });
  }
}

const api = module.exports = {
  isCommunityButton, handleCommunityButton, adoptOldPictures,
  verifyInvite,
  CommunityError, CATEGORIES, CATEGORY, icon, hue, PROMOS, DAYS, SORTS, SIZES, PER_PAGE, BANNER_HOSTS, VOTE_EVERY, REVIEWS_PER_PAGE,
  rating, liveExtra, similar, favoriteIds, toggleFavorite, mayReview, saveReview, deleteReview, replyReview, reportReview, moderateReview, reviewsOf, notifyReview, forGuild, remindVote,
  platform, setPlatform, cleanFields, cleanInvite, save, setVisible, remove, moderate, activePromos, buy, view, click, joinIntent, vote, report, catalog, one, statsOf, iconUrl, accountAge, listOf
};
