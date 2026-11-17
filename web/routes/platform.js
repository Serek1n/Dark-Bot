// /platform — for the owners of the DARK platform only (BOT_OWNER_IDS): DARK Coins (look up a wallet, give or take with a
// reason, the journal), prices of promotion, moderation of the catalog and complaints. Everyone else gets 404.
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { getUsers } = require('../discordApi');

const router = express.Router();
const coins = () => require('../../bot/modules/darkCoins');
const cm = () => require('../../bot/modules/communities');
const db = () => require('../../db');

function ownerOnly(req, res, next) {
  if (coins().isPlatformOwner(req.user?.id)) return next();
  res.status(404).render('error', { message: 'Страница не найдена.' });
}
const go = (q) => `/platform${q ? `?${q}` : ''}`;

router.get('/', signedIn, ownerOnly, async (req, res) => {
  const { Community, CommunityReport, DarkWallet } = db();
  const userId = /^\d{15,25}$/.test(String(req.query.user || '')) ? String(req.query.user) : null;
  const [settings, pending, reports, listed, top, log] = await Promise.all([
    cm().platform(),
    Community.findAll({ where: { status: 'pending' }, order: [['id', 'ASC']], limit: 50 }),
    CommunityReport.findAll({ where: { status: 'open' }, order: [['id', 'DESC']], limit: 50 }),
    Community.findAll({ order: [['id', 'DESC']], limit: 100 }),
    DarkWallet.findAll({ order: [['balance', 'DESC']], limit: 10 }),
    coins().history(userId, 50)
  ]);
  const byId = new Map(listed.map((c) => [c.id, c]));
  const users = await getUsers([...new Set([...top.map((w) => w.userId), ...log.flatMap((t) => [t.userId, t.actorId]), ...(userId ? [userId] : [])].filter(Boolean))]);
  res.render('platform/index', { title: 'Платформа DARK', settings, pending, reports, listed, byId, top, log, users, userId, balance: userId ? await coins().balanceOf(userId) : null,
    key: coins().newKey(), C: cm(), done: req.query.done || null, error: req.query.err ? String(req.query.err).slice(0, 200) : null });
});

router.post('/coins', signedIn, ownerOnly, async (req, res) => {
  const userId = String(req.body.userId || '').trim();
  try {
    const op = req.body.op === 'revoke' ? coins().revoke : coins().grant;
    const { duplicate } = await op({ actorId: req.user.id, userId, amount: req.body.amount, note: String(req.body.note || '').trim(), opKey: String(req.body.key || '') });
    res.redirect(go(`user=${encodeURIComponent(userId)}&done=${duplicate ? 'dup' : 'coins'}`));
  } catch (e) {
    if (!(e instanceof coins().CoinError)) throw e;
    res.redirect(go(`user=${encodeURIComponent(userId)}&err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/settings', signedIn, ownerOnly, async (req, res) => {
  try {
    const prices = {};
    for (const k of Object.keys(cm().PROMOS)) prices[k] = req.body[`price_${k}`];
    await cm().setPlatform(req.user.id, { prices, premoderation: req.body.premoderation === 'on' });
    res.redirect(go('done=settings'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(go(`err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/moderate', signedIn, ownerOnly, async (req, res) => {
  try {
    await cm().moderate(req.user.id, req.body.id, String(req.body.status || ''), req.body.note);
    res.redirect(go('done=moderated'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(go(`err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/reports/:id(\\d+)/close', signedIn, ownerOnly, async (req, res) => {
  await db().CommunityReport.update({ status: 'closed' }, { where: { id: Number(req.params.id) } });
  res.redirect(go('done=report'));
});

module.exports = router;
