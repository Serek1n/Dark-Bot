// Earning DARK Coins and buying them for Telegram Stars: the daily bonus (account age, a profile, the streak, once a day),
// paid votes (a few a day), verified joins (only after «Присоединиться», only for a real join, paid after the wait, cancelled
// when the member left), quests, the weekly top, the daily emission limit (held → the owner decides), frozen wallets, the
// server's wallet paying for promotion; Telegram: the order, the invoice, the check before charging, the payment credited
// once, the refund; the /wallet and /platform pages.
process.env.DATABASE_PATH = './data/test_darkcoins.sqlite';
process.env.BOT_OWNER_IDS = '700000000000000001';
process.env.TELEGRAM_BOT_TOKEN = '123:TEST';
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'Сервер', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'U' + String(id).slice(-2), avatar: '' }])), botApi: {} });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const coins = require('../bot/modules/darkCoins');
  const cm = require('../bot/modules/communities');
  const shop = require('../bot/modules/telegramShop');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const fails = async (f, re) => { try { await f(); } catch (e) { assert(re.test(e.message), e.message); return; } throw new Error('did not fail'); };
  const OWNER = '700000000000000001';
  const OLD = '300000000000000003'; // a 2015 account
  const idAt = (msAgo) => String(BigInt(Date.now() - msAgo - 1420070400000) << 22n);
  const NEW = idAt(2 * 86400000); // two days old
  const G = '800000000000000001';
  const later = (h) => new Date(Date.now() + h * 3600000);

  // a fake bot: who is on the server
  const onServer = new Set();
  const guild = { id: G, members: { fetch: async (id) => (onServer.has(id) ? { id } : Promise.reject(new Error('Unknown Member'))) } };
  require('../web/botBridge').setClient({ isReady: () => true, guilds: { cache: new Map([[G, guild]]) } });

  // a fake Telegram
  const calls = [];
  shop._setFetch(async (url, opt) => {
    const method = url.split('/').pop(); const body = JSON.parse(opt.body || '{}');
    calls.push({ method, body });
    const result = method === 'getMe' ? { username: 'dark_coins_bot' } : method === 'getUpdates' ? [] : true;
    return { json: async () => (method === 'refundStarPayment' && body.telegram_payment_charge_id === 'fail' ? { ok: false, description: 'CHARGE_NOT_FOUND' } : { ok: true, result }) };
  });

  await test('daily bonus: new accounts and people with no server profile can\'t; once a day; the streak grows', async () => {
    await fails(() => coins.claimDaily(NEW), /старше 30/);
    await fails(() => coins.claimDaily(OLD), /участников серверов/);
    await db.MemberProfile.create({ guildId: G, userId: OLD });
    const r1 = await coins.claimDaily(OLD);
    assert(r1.amount === 5 && r1.streak === 1, JSON.stringify(r1));
    await fails(() => coins.claimDaily(OLD), /уже получен/);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await db.DarkDaily.update({ lastDay: yesterday }, { where: { userId: OLD } });
    await db.DarkCoinTx.update({ opKey: `daily:${OLD}:${yesterday}` }, { where: { userId: OLD, kind: 'daily' } }); // as if taken yesterday
    const r2 = await coins.claimDaily(OLD);
    assert(r2.amount === 6 && r2.streak === 2 && await coins.balanceOf(OLD) === 11, JSON.stringify(r2));
  });

  let c;
  await test('publishing pays the one-time quest to the server\'s wallet, once', async () => {
    c = await cm.save(G, OWNER, { name: 'Сервер', shortDesc: 'Хороший сервер для всех', categories: ['social'], inviteUrl: 'https://discord.gg/abc' });
    await coins.checkQuests(c); await coins.checkQuests(c);
    assert(await coins.balanceOf(coins.guildWallet(G)) === 50, 'quest ' + await coins.balanceOf(coins.guildWallet(G)));
  });

  await test('votes: a reward waits 72 h; only the first three votes of a day are paid', async () => {
    const voters = []; for (let i = 0; i < 4; i++) voters.push(`3000000000000001${i}0`);
    const other = await cm.save('800000000000000002', OWNER, { name: 'Другой', shortDesc: 'Ещё один сервер тут', categories: ['social'], inviteUrl: 'https://discord.gg/def' });
    const ids = [c.id, other.id];
    for (let i = 0; i < 4; i++) await cm.vote(ids[i % 2], voters[0], `10.0.0.${i}`).catch(async () => { /* one per community per 12 h */ });
    const V = '300000000000000777';
    await cm.vote(c.id, V, '10.1.0.1'); await cm.vote(other.id, V, '10.1.0.2');
    const third = await cm.save('800000000000000003', OWNER, { name: 'Третий', shortDesc: 'И третий сервер тут', categories: ['social'], inviteUrl: 'https://discord.gg/ghi' });
    const fourth = await cm.save('800000000000000004', OWNER, { name: 'Четвёртый', shortDesc: 'И четвёртый сервер', categories: ['social'], inviteUrl: 'https://discord.gg/jkl' });
    await cm.vote(third.id, V, '10.1.0.3'); await cm.vote(fourth.id, V, '10.1.0.4');
    const p = await db.DarkCoinPending.findAll({ where: { wallet: V, kind: 'vote' } });
    assert(p.length === 3 && p.every((x) => x.status === 'pending' && new Date(x.payAt) > later(71)), 'three waiting: ' + p.length);
    assert(await coins.balanceOf(V) === 0, 'not paid yet');
    const st = await coins.settlePending(later(73));
    if (await coins.balanceOf(V) !== 6) console.log(st, (await db.DarkCoinPending.findAll({ where: { wallet: V }, raw: true })).map((x) => [x.status, x.reason]));
    assert(await coins.balanceOf(V) === 6, 'paid after the wait: ' + await coins.balanceOf(V));
  });

  await test('verified join: only after «Присоединиться» while signed in, only a real join, old account; paid after the wait if still there', async () => {
    const A = '300000000000000101'; const B = '300000000000000102'; const Y = NEW;
    assert(await coins.onMemberJoined(G, A) === null, 'no click — no reward');
    await cm.joinIntent(c, A, '1.1.1.1'); await cm.joinIntent(c, B, '1.1.1.2'); await cm.joinIntent(c, Y, '1.1.1.3');
    onServer.add(A); onServer.add(B); onServer.add(Y);
    assert(await coins.onMemberJoined(G, A), 'A queued');
    assert(await coins.onMemberJoined(G, A) === null, 'twice — once');
    assert(await coins.onMemberJoined(G, B), 'B queued');
    assert(await coins.onMemberJoined(G, Y) === null, 'a young account is not rewarded');
    onServer.delete(B); // B left before the wait was over
    const before = await coins.balanceOf(coins.guildWallet(G));
    const r = await coins.settlePending(later(73));
    const after = await coins.balanceOf(coins.guildWallet(G));
    assert(after - before === 20 && r.cancelled >= 1, `paid ${after - before}, cancelled ${r.cancelled}`);
    const pb = await db.DarkCoinPending.findOne({ where: { opKey: `join:${G}:${B}` } });
    assert(pb.status === 'cancelled' && /вышел/.test(pb.reason), pb.reason);
  });

  await test('the weekly top pays three servers once per week', async () => {
    const lastWeek = new Date(Date.now() - 7 * 86400000);
    await db.CommunityVote.update({ createdAt: lastWeek }, { where: {} });
    const before = await coins.balanceOf(coins.guildWallet(G));
    const r1 = await coins.payWeeklyTop(); const r2 = await coins.payWeeklyTop();
    assert(r1.paid.length >= 1 && r2.paid.every((x) => x.res.duplicate), JSON.stringify(r1));
    assert(await coins.balanceOf(coins.guildWallet(G)) > before, 'top paid');
  });

  await test('the daily emission limit holds rewards for the owner; a frozen wallet gets nothing and can\'t spend', async () => {
    await fails(() => coins.setEarnSettings('300000000000000005', { emissionPerDay: 1 }), /владелец/);
    await coins.setEarnSettings(OWNER, { emissionPerDay: 1 });
    const U = '300000000000000201';
    await db.MemberProfile.create({ guildId: G, userId: U });
    const r = await coins.claimDaily(U);
    assert(r.held && await coins.balanceOf(U) === 0, 'held');
    const held = await db.DarkCoinPending.findOne({ where: { wallet: U, status: 'held' } });
    await coins.decidePending(OWNER, held.id, true);
    assert(await coins.balanceOf(U) === 5, 'approved by the owner');
    await coins.setEarnSettings(OWNER, { emissionPerDay: 20000 });
    await coins.setFrozen(OWNER, U, true);
    await fails(() => coins.charge(U, 1, { kind: 'promo', opKey: 'frozen-test-1' }), /заморожен/);
    await coins.queueReward(U, 2, { kind: 'vote', opKey: 'frozen-vote-1', userId: U });
    await coins.settlePending(later(80));
    assert((await db.DarkCoinPending.findOne({ where: { opKey: 'frozen-vote-1' } })).status === 'cancelled', 'cancelled for a frozen wallet');
    await coins.setFrozen(OWNER, U, false);
  });

  await test('promotion can be paid from the server\'s wallet', async () => {
    const before = await coins.balanceOf(coins.guildWallet(G));
    await cm.buy(G, OWNER, 'bump', 1, 'srvwallet0001', 'server');
    assert(await coins.balanceOf(coins.guildWallet(G)) === before - 50, 'charged the server');
  });

  let order;
  await test('Telegram: an order for the signed-in user, the bot sends an invoice in Stars', async () => {
    const r = await shop.createOrder(OLD, 'm');
    order = r.order;
    assert(r.link === `https://t.me/dark_coins_bot?start=${order.token}` && order.coins === 550 && order.stars === 250, r.link);
    await fails(() => shop.createOrder(OLD, 'nope'), /пакета нет/);
    calls.length = 0;
    assert(await shop.handleUpdate({ message: { chat: { id: 5 }, from: { id: 99 }, text: `/start ${order.token}` } }) === 'invoice', 'invoice');
    const inv = calls.find((x) => x.method === 'sendInvoice').body;
    assert(inv.currency === 'XTR' && inv.prices[0].amount === 250 && inv.payload === order.token, JSON.stringify(inv));
    assert(await shop.handleUpdate({ message: { chat: { id: 5 }, text: '/start ffffffffffffffffffffffffffffffff' } }) === 'expired', 'unknown order');
    assert(await shop.handleUpdate({ message: { chat: { id: 5 }, text: '/terms' } }) === 'terms' && await shop.handleUpdate({ message: { chat: { id: 5 }, text: '/paysupport' } }) === 'support', 'terms, support');
  });

  await test('Telegram: the check before charging refuses a changed sum; the payment is credited once', async () => {
    assert(await shop.handleUpdate({ pre_checkout_query: { id: 'q1', currency: 'XTR', total_amount: 1, invoice_payload: order.token } }) === 'precheckout-refused', 'wrong sum');
    assert(await shop.handleUpdate({ pre_checkout_query: { id: 'q2', currency: 'XTR', total_amount: 250, invoice_payload: order.token } }) === 'precheckout-ok', 'ok');
    const before = await coins.balanceOf(OLD);
    const pay = { currency: 'XTR', total_amount: 250, invoice_payload: order.token, telegram_payment_charge_id: 'charge-1' };
    const [a, b] = await Promise.all([shop.handleUpdate({ message: { chat: { id: 5 }, from: { id: 99 }, successful_payment: pay } }), shop.handleUpdate({ message: { chat: { id: 5 }, from: { id: 99 }, successful_payment: pay } })]);
    assert([a, b].sort().join() === 'duplicate,paid', `${a} ${b}`);
    assert(await coins.balanceOf(OLD) === before + 550, 'credited once');
    const o = await db.DarkCoinOrder.findByPk(order.id);
    assert(o.status === 'paid' && o.chargeId === 'charge-1' && o.tgUserId === '99', JSON.stringify(o));
    assert(await shop.handleUpdate({ pre_checkout_query: { id: 'q3', currency: 'XTR', total_amount: 250, invoice_payload: order.token } }) === 'precheckout-refused', 'a paid order can\'t be paid again');
  });

  await test('Telegram refund: the owner only; coins back first, Stars returned; spent coins can\'t be refunded', async () => {
    await fails(() => shop.refundOrder('300000000000000005', order.id), /владелец/);
    const before = await coins.balanceOf(OLD);
    calls.length = 0;
    await shop.refundOrder(OWNER, order.id);
    assert(await coins.balanceOf(OLD) === before - 550 && calls.some((x) => x.method === 'refundStarPayment' && x.body.telegram_payment_charge_id === 'charge-1'), 'refunded');
    assert((await db.DarkCoinOrder.findByPk(order.id)).status === 'refunded', 'status');
    const { order: o2 } = await shop.createOrder('300000000000000301', 's');
    await shop.creditPurchase({ currency: 'XTR', total_amount: o2.stars, invoice_payload: o2.token, telegram_payment_charge_id: 'charge-2' }, 77);
    await coins.charge('300000000000000301', 60, { kind: 'promo', opKey: 'spent-it-0001' });
    await fails(() => shop.refundOrder(OWNER, o2.id), /потрачены/);
    const { order: o3 } = await shop.createOrder('300000000000000302', 's');
    await shop.creditPurchase({ currency: 'XTR', total_amount: o3.stars, invoice_payload: o3.token, telegram_payment_charge_id: 'fail' }, 78);
    await fails(() => shop.refundOrder(OWNER, o3.id), /не вернул/);
    assert(await coins.balanceOf('300000000000000302') === 100, 'coins given back when Telegram refused');
  });

  await test('web: /wallet shows balance, bonus, packages; buying makes an order and shows the Telegram button; /platform has the rules', async () => {
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use(express.urlencoded({ extended: true }));
    let who = OLD;
    app.use((req, res, next) => { req.user = { id: who, username: 'u' }; req.isAuthenticated = () => true; res.locals.user = req.user; next(); });
    require('../web/modules');
    app.use('/wallet', require('../web/routes/wallet'));
    app.use('/platform', require('../web/routes/platform'));
    app.use('/dashboard', require('../web/routes/dashboard/community'));
    app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p, b) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    try {
      let t = await (await fetch(base + '/wallet')).text();
      assert(t.includes('Ежедневный бонус') && t.includes('550') && t.includes('⭐') && t.includes('Покупка'), 'wallet page');
      const r = await post('/wallet/buy', { pkg: 'l' });
      const loc = r.headers.get('location');
      assert(/^\/wallet\?order=\d+$/.test(loc), loc);
      t = await (await fetch(base + loc)).text();
      assert(t.includes('Оплатить в Telegram') && t.includes('https://t.me/dark_coins_bot?start='), 'telegram button');
      who = OWNER;
      t = await (await fetch(base + '/platform')).text();
      assert(t.includes('Правила заработка') && t.includes('Пакеты Telegram Stars') && t.includes('Покупки за звёзды'), 'platform');
      await post('/platform/earn', { join: '25' });
      assert((await coins.earnSettings()).join === 25, 'rule saved');
      t = await (await fetch(`${base}/dashboard/${G}/community`)).text();
      assert(t.includes('Кошелёк сервера') && t.includes('name="from"'), 'server wallet on the owner page');
    } finally { server.close(); }
  });

  require('../web/botBridge').setClient(null);
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : `\n   ${r.e}`}`);
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
