// Buying DARK Coins for Telegram Stars (XTR — Telegram's currency for digital goods, no card data ever reaches us).
//
// 1. On the site (/wallet) a signed-in Discord user picks a package → an order with a secret token is made for HIS wallet.
// 2. The link t.me/<bot>?start=<token> opens our Telegram bot, which sends an invoice for that order.
// 3. Telegram asks before charging (pre_checkout_query): the order must still be unpaid and the sum must match.
// 4. After the payment (successful_payment) the coins are credited in one transaction keyed by Telegram's payment id: a
//    repeated update credits nothing twice. The platform owner can refund a payment on /platform (Stars go back, coins are
//    taken back).
// The bot reads updates by long polling (getUpdates): no webhook, no open port. Needs TELEGRAM_BOT_TOKEN.
const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

class ShopError extends Error {}
const db = () => require('../../db');
const coins = () => require('./darkCoins');
let fetchImpl = (...a) => fetch(...a);
// the token as @BotFather gives it; quotes, spaces and a pasted "bot" prefix are forgiven
const token = () => String(process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^['"]|['"]$/g, '').trim().replace(/^bot(?=\d)/i, '');
const enabled = () => Boolean(token());
let botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') || null;

const PACKAGE_DEFAULTS = {
  s: { coins: 100, stars: 50 },
  m: { coins: 550, stars: 250 },
  l: { coins: 1200, stars: 500 },
  xl: { coins: 2600, stars: 1000 }
};
const ORDER_TTL = 24 * 3600 * 1000;
const ORDERS_PER_HOUR = 5;

async function packages() {
  const row = await db().PlatformSetting.findOne({ where: { key: 'tg_packages' } });
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  const out = {};
  for (const [k, d] of Object.entries(PACKAGE_DEFAULTS)) {
    const p = saved[k] || {};
    const c = Math.trunc(Number(p.coins)); const s = Math.trunc(Number(p.stars));
    out[k] = { key: k, coins: c >= 1 ? c : d.coins, stars: s >= 1 ? s : d.stars, on: p.on !== false };
  }
  return out;
}
async function setPackages(actorId, values) {
  if (!coins().isPlatformOwner(actorId)) throw new ShopError('Это может только владелец платформы.');
  const cur = await packages();
  for (const k of Object.keys(PACKAGE_DEFAULTS)) {
    const v = values[k] || {};
    const c = Math.trunc(Number(v.coins)); const s = Math.trunc(Number(v.stars));
    if (!(c >= 1 && c <= 1_000_000 && s >= 1 && s <= 100_000)) throw new ShopError('Пакет: от 1 до 1 000 000 монет и от 1 до 100 000 звёзд.');
    cur[k] = { key: k, coins: c, stars: s, on: Boolean(v.on) };
  }
  await db().PlatformSetting.upsert({ key: 'tg_packages', value: JSON.stringify(cur) });
  return cur;
}

async function api(method, body) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new ShopError(`Telegram: ${data.description || res.status}`);
  return data.result;
}
async function username() {
  if (botUsername) return botUsername;
  if (!enabled()) return null;
  botUsername = (await api('getMe')).username;
  return botUsername;
}

/**
 * Is the Telegram bot really connected? Asks Telegram (getMe) at most once a minute. { ok, username, error } — error is a
 * plain explanation for the platform owner (shown on /platform), never the token itself.
 */
let statusCache = null;
async function status(force = false) {
  if (!enabled()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан в .env.' };
  if (!force && statusCache && Date.now() - statusCache.at < 60000) return statusCache.value;
  let value;
  if (!/^\d{5,15}:[\w-]{30,}$/.test(token())) {
    value = { ok: false, error: 'TELEGRAM_BOT_TOKEN не похож на токен от @BotFather (вид: 1234567890:AAH...). Проверьте, что он скопирован целиком.' };
  } else {
    try {
      const me = await api('getMe');
      botUsername = me.username;
      value = { ok: true, username: me.username };
    } catch (err) {
      value = { ok: false, error: /Unauthorized|401/i.test(err.message)
        ? 'Telegram не принял токен (Unauthorized): он неверный или был сброшен. Возьмите актуальный в @BotFather → /mybots → бот → API Token и перезапустите бота.'
        : `Telegram недоступен: ${err.message}` };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

/** A new order of one package for a Discord user. Returns { order, link }. */
async function createOrder(userId, packageKey) {
  if (!enabled()) throw new ShopError('Покупка через Telegram пока не подключена.');
  // the bot must really work before an order is made (else the person gets a dead link)
  const st = await status();
  if (!st.ok) {
    logger.warn(`Telegram shop: ${st.error}`);
    throw new ShopError('Покупка через Telegram временно недоступна: бот оплаты сейчас не отвечает. Попробуйте позже — администрация платформы уже видит ошибку.');
  }
  if (!coins().isWallet(userId) || String(userId).startsWith('g')) throw new ShopError('Неверный пользователь.');
  const p = (await packages())[packageKey];
  if (!p || !p.on) throw new ShopError('Такого пакета нет.');
  const { DarkCoinOrder } = db();
  if ((await DarkCoinOrder.count({ where: { userId: String(userId), createdAt: { [Op.gte]: new Date(Date.now() - 3600000) } } })) >= ORDERS_PER_HOUR) throw new ShopError('Слишком много заказов за час. Оплатите уже созданный или подождите.');
  if (await coins().isFrozen(userId)) throw new ShopError('Кошелёк заморожен администрацией платформы.');
  const order = await DarkCoinOrder.create({ token: crypto.randomBytes(16).toString('hex'), userId: String(userId), packageKey: p.key, coins: p.coins, stars: p.stars });
  return { order, link: `https://t.me/${await username()}?start=${order.token}` };
}

const orderByToken = (t) => (/^[0-9a-f]{32}$/.test(String(t || '')) ? db().DarkCoinOrder.findOne({ where: { token: String(t) } }) : null);
const fresh = (o) => o && o.status === 'created' && Date.now() - new Date(o.createdAt).getTime() < ORDER_TTL;

const TEXT = {
  hello: 'Это магазин DARK Coins — валюты платформы бота Dark для продвижения сообществ.\n\nЧтобы купить, войдите на сайт Dark через Discord, откройте «Кошелёк», выберите пакет и нажмите «Оплатить в Telegram» — бот пришлёт счёт в звёздах.\n\n/terms — условия · /paysupport — помощь с оплатой',
  terms: 'Условия покупки DARK Coins\n\n• DARK Coins — внутренняя валюта платформы Dark. Их можно потратить только на продвижение сообществ в каталоге Dark. Их нельзя вывести, обменять на деньги или на валюту серверов.\n• Монеты зачисляются на кошелёк того аккаунта Discord, с которого сделан заказ на сайте, сразу после оплаты.\n• Возврат звёзд возможен, пока купленные монеты не потрачены: напишите в /paysupport.\n• Администрация платформы может заморозить кошелёк при нарушениях.',
  support: () => `Помощь с оплатой\n\nОпишите проблему и пришлите номер заказа из сообщения об оплате. Связь: ${process.env.CONTACT_INFO || 'администрация платформы Dark'}.\n\nВозврат звёзд возможен, пока купленные монеты не потрачены.`,
  expired: 'Этот заказ уже оплачен или устарел (заказ действует 24 часа). Создайте новый на сайте в разделе «Кошелёк».'
};

/** One update from Telegram. */
async function handleUpdate(u) {
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    const o = await orderByToken(q.invoice_payload);
    const ok = fresh(o) && q.currency === 'XTR' && Number(q.total_amount) === o.stars && !(await coins().isFrozen(o.userId));
    await api('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Заказ уже оплачен, устарел или изменился. Создайте новый на сайте.' });
    return ok ? 'precheckout-ok' : 'precheckout-refused';
  }
  const m = u.message;
  if (!m) return null;
  const chatId = m.chat?.id;
  if (m.successful_payment) {
    const r = await creditPurchase(m.successful_payment, m.from?.id);
    await api('sendMessage', { chat_id: chatId, text: r.credited ? `✅ Оплачено. На кошелёк зачислено ${r.order.coins} DARK Coins.\nЗаказ №${r.order.id} · платёж ${m.successful_payment.telegram_payment_charge_id}` : r.duplicate ? 'Этот платёж уже зачислен.' : `⚠️ Платёж получен, но заказ не найден. Напишите в /paysupport и укажите платёж ${m.successful_payment.telegram_payment_charge_id}.` }).catch(() => {});
    return r.credited ? 'paid' : r.duplicate ? 'duplicate' : 'orphan';
  }
  const text = String(m.text || '').trim();
  if (text === '/terms') { await api('sendMessage', { chat_id: chatId, text: TEXT.terms }); return 'terms'; }
  if (text === '/paysupport') { await api('sendMessage', { chat_id: chatId, text: TEXT.support() }); return 'support'; }
  const start = /^\/start(?:\s+(\S+))?$/.exec(text);
  if (start && start[1]) {
    const o = await orderByToken(start[1]);
    if (!fresh(o)) { await api('sendMessage', { chat_id: chatId, text: TEXT.expired }); return 'expired'; }
    await api('sendInvoice', {
      chat_id: chatId, title: `${o.coins} DARK Coins`,
      description: `Пополнение кошелька DARK Coins (заказ №${o.id}). Монеты — для продвижения сообществ в каталоге Dark.`,
      payload: o.token, currency: 'XTR', prices: [{ label: `${o.coins} DARK Coins`, amount: o.stars }]
    });
    return 'invoice';
  }
  if (text.startsWith('/start') || text) { await api('sendMessage', { chat_id: chatId, text: TEXT.hello }); return 'hello'; }
  return null;
}

/**
 * Credits a paid order. Idempotent by Telegram's charge id: the order is switched to "paid" by a conditional update and
 * the coins are added with the key tg:<charge id>, both in one transaction.
 */
async function creditPurchase(payment, tgUserId) {
  const { DarkCoinOrder, inTransaction } = db();
  const chargeId = String(payment?.telegram_payment_charge_id || '');
  if (!chargeId) return { credited: false };
  const done = await DarkCoinOrder.findOne({ where: { chargeId } });
  if (done) return { credited: false, duplicate: true, order: done };
  const o = await orderByToken(payment.invoice_payload);
  if (!o || payment.currency !== 'XTR' || Number(payment.total_amount) !== o.stars) {
    logger.warn(`Telegram payment ${chargeId} without a matching order (payload ${String(payment.invoice_payload).slice(0, 40)})`);
    return { credited: false };
  }
  try {
    return await inTransaction(async (t) => {
      const [changed] = await DarkCoinOrder.update({ status: 'paid', chargeId, tgUserId: tgUserId ? String(tgUserId) : null, paidAt: new Date() }, { where: { id: o.id, status: 'created' }, transaction: t });
      if (!changed) return { credited: false, duplicate: true, order: o };
      // a purchase is credited even to a frozen wallet: the person paid; spending stays blocked while it is frozen
      await coins().move(o.userId, o.coins, { kind: 'purchase', opKey: `tg-payment:${chargeId.slice(0, 80)}`, note: `Покупка за ${o.stars} ⭐ · заказ №${o.id}`, allowFrozen: true }, t);
      return { credited: true, order: await DarkCoinOrder.findByPk(o.id, { transaction: t }) };
    });
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) return { credited: false, duplicate: true, order: o };
    throw err;
  }
}

/** The platform owner refunds a paid order: the coins are taken back first, then Telegram returns the Stars. */
async function refundOrder(actorId, orderId) {
  if (!coins().isPlatformOwner(actorId)) throw new ShopError('Это может только владелец платформы.');
  const { DarkCoinOrder } = db();
  const o = await DarkCoinOrder.findByPk(Number(orderId));
  if (!o || o.status !== 'paid') throw new ShopError('Заказ не найден или не оплачен.');
  if (!o.tgUserId) throw new ShopError('Неизвестен покупатель в Telegram — верните звёзды вручную.');
  try {
    await coins().move(o.userId, -o.coins, { kind: 'refund', opKey: `tgrefund:${o.chargeId}`, actorId, note: `Возврат заказа №${o.id}`, allowFrozen: true });
  } catch (err) {
    if (err instanceof coins().CoinError) throw new ShopError(`Не вернуть: ${err.message} Купленные монеты уже потрачены.`);
    throw err;
  }
  try {
    await api('refundStarPayment', { user_id: Number(o.tgUserId), telegram_payment_charge_id: o.chargeId });
  } catch (err) {
    // Telegram refused: give the coins back, nothing changed for the buyer
    await coins().move(o.userId, o.coins, { kind: 'refund', opKey: `tgrefund-undo:${o.chargeId}`, actorId, note: `Отмена возврата заказа №${o.id}`, allowFrozen: true });
    throw new ShopError(`Telegram не вернул звёзды: ${err.message}`);
  }
  await o.update({ status: 'refunded', refundedAt: new Date() });
  return o;
}

// ---- long polling ----
let running = false;
async function pollOnce() {
  const { PlatformSetting } = db();
  const row = await PlatformSetting.findOne({ where: { key: 'tg_offset' } });
  const offset = Number(row?.value || 0);
  const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'pre_checkout_query'] });
  for (const u of updates) {
    try { await handleUpdate(u); } catch (err) { logger.warn(`Telegram update ${u.update_id}: ${err.message}`); }
    await PlatformSetting.upsert({ key: 'tg_offset', value: String(u.update_id + 1) });
  }
  return updates.length;
}
function startTelegramShop() {
  if (!enabled() || running) return false;
  running = true;
  username().then((n) => logger.info(`Telegram shop: @${n}`)).catch((err) => logger.warn(`Telegram shop: ${err.message}`));
  api('setMyCommands', { commands: [{ command: 'start', description: 'Магазин DARK Coins' }, { command: 'terms', description: 'Условия покупки' }, { command: 'paysupport', description: 'Помощь с оплатой' }] }).catch(() => {});
  (async function loop() {
    let lastError = '';
    while (running) {
      try { await pollOnce(); lastError = ''; } catch (err) {
        const unauthorized = /Unauthorized|401/i.test(err.message);
        const text = unauthorized ? 'Telegram не принял TELEGRAM_BOT_TOKEN (Unauthorized) — проверьте токен в .env' : `Telegram polling: ${err.message}`;
        if (text !== lastError) logger.warn(text); // the same error is written once, not every few seconds
        lastError = text;
        await new Promise((r) => setTimeout(r, unauthorized ? 5 * 60 * 1000 : 15000));
      }
    }
  })();
  return true;
}
function stopTelegramShop() { running = false; }

module.exports = {
  ShopError, PACKAGE_DEFAULTS, enabled, status, packages, setPackages, createOrder, handleUpdate, creditPurchase, refundOrder, pollOnce, startTelegramShop, stopTelegramShop, username, TEXT,
  _setFetch: (f) => { fetchImpl = f; }, _setUsername: (n) => { botUsername = n; }
};
