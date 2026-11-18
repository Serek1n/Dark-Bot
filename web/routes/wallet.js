// /wallet — a signed-in person's DARK Coins: balance, the daily bonus, rewards that wait, the journal, and buying coins for
// Telegram Stars (an order is made here for HIS wallet, paid in the Telegram bot).
// The order's page link goes to t.me: the forms of the site may only post to the site itself (CSP form-action 'self').
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const coins = () => require('../../bot/modules/darkCoins');
const shop = () => require('../../bot/modules/telegramShop');
const db = () => require('../../db');
const limit = rateLimit({ windowMs: 60 * 1000, max: 15, message: 'Слишком много запросов. Подождите минуту.' });
const back = (q) => `/wallet${q ? `?${q}` : ''}`;

router.get('/', signedIn, async (req, res) => {
  const me = req.user.id;
  const { DarkCoinPending, DarkCoinOrder } = db();
  const [balance, log, pending, daily, earn, packages, orders, frozen] = await Promise.all([
    coins().balanceOf(me), coins().history(me, 30),
    DarkCoinPending.findAll({ where: { wallet: me }, order: [['id', 'DESC']], limit: 20 }),
    coins().dailyState(me), coins().earnSettings(), shop().packages(),
    DarkCoinOrder.findAll({ where: { userId: me }, order: [['id', 'DESC']], limit: 10 }),
    coins().isFrozen(me)
  ]);
  let order = null; let orderLink = null;
  if (req.query.order) {
    order = await DarkCoinOrder.findOne({ where: { id: Number(req.query.order) || 0, userId: me, status: 'created' } });
    if (order) orderLink = `https://t.me/${await shop().username().catch(() => null)}?start=${order.token}`;
  }
  res.render('wallet/index', { order, orderLink, title: 'Кошелёк DARK Coins', balance, log, pending, daily, earn, packages, orders, frozen, tg: shop().enabled(),
    done: req.query.done || null, got: Number(req.query.got) || 0, error: req.query.err ? String(req.query.err).slice(0, 200) : null });
});

router.post('/daily', signedIn, limit, async (req, res) => {
  try {
    const r = await coins().claimDaily(req.user.id);
    res.redirect(back(r.held ? 'done=held' : `done=daily&got=${r.amount}`));
  } catch (e) {
    if (!(e instanceof coins().CoinError)) throw e;
    res.redirect(back(`err=${encodeURIComponent(e.message)}`));
  }
});

router.post('/buy', signedIn, limit, async (req, res) => {
  try {
    // back to the wallet with the order: the page shows the button to Telegram (a form may not redirect to another site)
    const { order } = await shop().createOrder(req.user.id, String(req.body.pkg || ''));
    res.redirect(back(`order=${order.id}`));
  } catch (e) {
    if (!(e instanceof shop().ShopError) && !(e instanceof coins().CoinError)) throw e;
    res.redirect(back(`err=${encodeURIComponent(e.message)}`));
  }
});

module.exports = router;
