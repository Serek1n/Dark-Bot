// /platform — for the owners of the DARK platform only (BOT_OWNER_IDS): DARK Coins (look up a wallet, give or take with a
// reason, the journal), prices of promotion, moderation of the catalog and complaints. Everyone else gets 404.
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { getUsers } = require('../discordApi');

const router = express.Router();
const coins = () => require('../../bot/modules/darkCoins');
const cm = () => require('../../bot/modules/communities');
const shop = () => require('../../bot/modules/telegramShop');
const db = () => require('../../db');

function ownerOnly(req, res, next) {
  if (coins().isPlatformOwner(req.user?.id)) return next();
  res.status(404).render('error', { message: 'Страница не найдена.' });
}
const go = (q) => `/platform${q ? `?${q}` : ''}`;
// the page is split into tabs (?tab=…); after an action the owner lands back on the tab it was made from
const TABS = ['queue', 'catalog', 'coins', 'settings'];
const tabOf = (v, def) => (TABS.includes(String(v)) ? String(v) : def);
// an action of the owner that may fail with a readable reason: back to the page with it
const act = (fn, done, tab = 'queue') => async (req, res) => {
  try { await fn(req); res.redirect(go(`tab=${tab}&done=${done}`)); } catch (e) {
    if (!(e instanceof coins().CoinError) && !(e instanceof cm().CommunityError) && !(e instanceof shop().ShopError)) throw e;
    res.redirect(go(`tab=${tab}&err=${encodeURIComponent(e.message)}`));
  }
};

router.get('/', signedIn, ownerOnly, async (req, res) => {
  const { Community, CommunityReport, DarkWallet } = db();
  // a server's wallet is «g» + its id; the form asks «Участник / Сервер» instead of making the owner type the prefix
  const raw = String(req.query.user || '').trim().replace(/\s+/g, '');
  const wanted = req.query.kind === 'server' && /^\d+$/.test(raw) ? 'g' + raw : raw;
  const userId = /^g?\d{15,25}$/.test(wanted) ? wanted : null;
  const [settings, pending, reports, listed, top, log] = await Promise.all([
    cm().platform(),
    Community.findAll({ where: { status: 'pending' }, order: [['id', 'ASC']], limit: 50 }),
    CommunityReport.findAll({ where: { status: 'open' }, order: [['id', 'DESC']], limit: 50 }),
    Community.findAll({ order: [['id', 'DESC']], limit: 100 }),
    DarkWallet.findAll({ order: [['balance', 'DESC']], limit: 10 }),
    coins().history(userId, 50)
  ]);
  const byId = new Map(listed.map((c) => [c.id, c]));
  const { CommunityReview, CommunityReviewReport } = db();
  const { Op } = require('sequelize');
  const badReviews = await CommunityReview.findAll({ where: { [Op.or]: [{ reports: { [Op.gt]: 0 } }, { status: 'hidden' }] }, order: [['reports', 'DESC'], ['id', 'DESC']], limit: 50, raw: true });
  const reviewReasons = badReviews.length ? await CommunityReviewReport.findAll({ where: { reviewId: badReviews.map((r) => r.id) }, order: [['id', 'DESC']], raw: true }) : [];
  for (const r of badReviews) if (!byId.has(r.communityId)) { const c = await Community.findByPk(r.communityId); if (c) byId.set(c.id, c); }
  const { DarkCoinPending, DarkCoinOrder } = db();
  const [earn, packages, held, orders, emitted, frozen] = await Promise.all([
    coins().earnSettings(), shop().packages(),
    DarkCoinPending.findAll({ where: { status: ['held', 'pending'] }, order: [['status', 'ASC'], ['id', 'DESC']], limit: 50 }),
    DarkCoinOrder.findAll({ where: { status: 'paid' }, order: [['id', 'DESC']], limit: 30 }),
    coins().emittedToday(), userId ? coins().isFrozen(userId) : false
  ]);
  const users = await getUsers([...new Set([...badReviews.map((r) => r.userId), ...top.map((w) => w.userId), ...log.flatMap((t) => [t.userId, t.actorId]), ...orders.map((o) => o.userId), ...held.map((p) => p.wallet), ...(userId ? [userId] : [])].filter((id) => /^\d{15,25}$/.test(String(id || ''))))]);
  const tab = tabOf(req.query.tab, userId ? 'coins' : 'queue');
  const state = ['published', 'pending', 'hidden', 'blocked'].includes(String(req.query.state)) ? String(req.query.state) : null;
  const decide = Number(req.query.decide) || null;
  res.render('platform/index', { title: 'Платформа DARK', tab, state, decide, badId: Boolean(raw) && !userId, settings, pending, reports, listed, byId, badReviews, reviewReasons, top, log, users, userId, balance: userId ? await coins().balanceOf(userId) : null,
    key: coins().newKey(), C: cm(), earn, EARN: coins().EARN_DEFAULTS, packages, held, orders, emitted, frozen, tg: shop().enabled(), tgStatus: await shop().status(true), done: req.query.done || null, error: req.query.err ? String(req.query.err).slice(0, 200) : null });
});

router.post('/coins', signedIn, ownerOnly, async (req, res) => {
  const userId = String(req.body.userId || '').trim();
  try {
    const op = req.body.op === 'revoke' ? coins().revoke : coins().grant;
    const { duplicate } = await op({ actorId: req.user.id, userId, amount: req.body.amount, note: String(req.body.note || '').trim(), opKey: String(req.body.key || '') });
    res.redirect(go(`tab=coins&user=${encodeURIComponent(userId)}&done=${duplicate ? 'dup' : 'coins'}`));
  } catch (e) {
    if (!(e instanceof coins().CoinError)) throw e;
    res.redirect(go(`tab=coins&user=${encodeURIComponent(userId)}&err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/settings', signedIn, ownerOnly, async (req, res) => {
  try {
    const prices = {};
    for (const k of Object.keys(cm().PROMOS)) prices[k] = req.body[`price_${k}`];
    await cm().setPlatform(req.user.id, { prices, premoderation: req.body.premoderation === 'on' });
    res.redirect(go('tab=settings&done=settings'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(go(`tab=settings&err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/moderate', signedIn, ownerOnly, async (req, res) => {
  const back = tabOf(req.body.back, 'queue');
  try {
    await cm().moderate(req.user.id, req.body.id, String(req.body.status || ''), req.body.note);
    res.redirect(go(`tab=${back}&done=moderated`));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(go(`tab=${back}&err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/reviews/:id(\\d+)', signedIn, ownerOnly, act((req) => cm().moderateReview(req.user.id, req.params.id, String(req.body.action || '')), 'review'));

router.post('/reports/:id(\\d+)/close', signedIn, ownerOnly, async (req, res) => {
  await db().CommunityReport.update({ status: 'closed' }, { where: { id: Number(req.params.id) } });
  res.redirect(go('tab=queue&done=report'));
});

router.post('/earn', signedIn, ownerOnly, act((req) => coins().setEarnSettings(req.user.id, req.body), 'settings', 'settings'));
router.post('/pending/:id(\\d+)', signedIn, ownerOnly, act((req) => coins().decidePending(req.user.id, req.params.id, req.body.approve === '1'), 'pending', 'queue'));
router.post('/freeze', signedIn, ownerOnly, async (req, res) => {
  const userId = String(req.body.userId || '');
  try { await coins().setFrozen(req.user.id, userId, req.body.frozen === '1'); res.redirect(go(`tab=coins&user=${encodeURIComponent(userId)}&done=frozen`)); } catch (e) {
    if (!(e instanceof coins().CoinError)) throw e;
    res.redirect(go(`tab=coins&user=${encodeURIComponent(userId)}&err=${encodeURIComponent(e.message)}`));
  }
});
const packagesOf = (body) => {
  const v = {};
  for (const k of Object.keys(shop().PACKAGE_DEFAULTS)) v[k] = { coins: body[`coins_${k}`], stars: body[`stars_${k}`], on: body[`on_${k}`] === 'on' };
  return v;
};
router.post('/packages', signedIn, ownerOnly, act((req) => shop().setPackages(req.user.id, packagesOf(req.body)), 'settings', 'settings'));

// The «Настройки» tab saves everything in one form: the earning rules first (they check all numbers before writing),
// then the prices with pre-moderation, then the Telegram Stars packages.
router.post('/config', signedIn, ownerOnly, act(async (req) => {
  await coins().setEarnSettings(req.user.id, req.body);
  const prices = {};
  for (const k of Object.keys(cm().PROMOS)) prices[k] = req.body[`price_${k}`];
  await cm().setPlatform(req.user.id, { prices, premoderation: req.body.premoderation === 'on' });
  await shop().setPackages(req.user.id, packagesOf(req.body));
}, 'settings', 'settings'));

module.exports = router;
