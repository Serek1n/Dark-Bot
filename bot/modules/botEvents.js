// "События бота": everything the bot announces on the server by itself, in one place. Each event has a plain name, when it
// happens, an example of the message, a switch (unless the message IS the tool — a goal card with its buttons, a vote) and
// its own channel (empty = the common events channel). Switching economy sections on is announced as the admin chose:
// one summary in plain words, a message per section, both (in the order he picked) or nothing.
// Stored as JSON in GuildSettings.botEvents; the common channel is GuildSettings.economyEventsChannelId.

// module: the panel module the event belongs to (its page is linked); section: the economy section that must be on.
const TYPES = [
  { key: 'activation', module: 'economy', title: 'Включены новые разделы', when: 'Администратор включил разделы экономики в панели',
    example: 'Что нового в экономике сервера\n• Работа: команда /work. Смена раз в 60 мин., чем выше уровень, тем больше платят.' },
  { key: 'goal_open', module: 'economy', section: 'goals', required: true, title: 'Новая общая цель', when: 'Открыт сбор на цель',
    example: 'Общая цель: Неделя двойного опыта\n0 из 20 000 · кнопки «Вложить 100», «Вложить 1000», «Своя сумма»', why: 'Это и есть карточка цели: через её кнопки участники вкладывают деньги.' },
  { key: 'goal_done', module: 'economy', section: 'goals', title: 'Цель собрана', when: 'Сервер собрал нужную сумму',
    example: 'Цель собрана: Неделя двойного опыта\nСервер собрал 20 000 монет. Опыт ×2 для всех на 168 ч — уже действует.' },
  { key: 'goal_failed', module: 'economy', section: 'goals', title: 'Цель не собрана или отменена', when: 'Срок вышел или администратор отменил цель',
    example: 'Не успели: Турнир\nСобрано 3 200 из 5 000. Все вложения вернулись.' },
  { key: 'vote', module: 'economy', section: 'treasury', required: true, title: 'Голосование казны', when: 'Администратор начал голосование, на что потратить казну',
    example: 'На что потратить казну?\n1️⃣ Раздать 2 000 поровну всем, кто был активен за неделю\n2️⃣ Розыгрыш: 1 × 1 000 монет', why: 'Это само голосование: участники выбирают реакциями.' },
  { key: 'vote_result', module: 'economy', section: 'treasury', title: 'Итог голосования казны', when: 'Голосование закончилось',
    example: 'Решение голосования выполнено: раздача.' },
  { key: 'giveaway', module: 'economy', section: 'treasury', required: true, title: 'Розыгрыш из казны', when: 'Администратор запустил розыгрыш с призом из казны',
    example: 'Розыгрыш: 1 000 монет из казны сервера · кнопка участия', why: 'Это сам розыгрыш: участвуют по кнопке.' },
  { key: 'season_end', module: 'economy', section: 'seasons', title: 'Конец сезона', when: 'Сезон закончился по сроку или его завершили в панели',
    example: 'Сезон 2 завершён\nЛучшие по богатству получают значок «Сезон 2» в профиль:\n🥇 Мария — 31 000\n\nМонеты обнулились, кристаллы и роли остались. Начался сезон 3!' }
];
const BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));
const ORDERS = ['summary-first', 'each-first'];

const parse = (v) => { try { const o = typeof v === 'string' ? JSON.parse(v || '{}') : v; return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const snow = (v) => (/^\d{15,25}$/.test(String(v || '')) ? String(v) : null);

/** The whole setup with defaults: { enabled, channelId, summary, each, order, types: { key: { on, channelId } } }. */
function read(settings) {
  const o = parse(settings?.botEvents);
  // before the module existed the economy page had one choice: each | summary | quiet
  const legacy = settings?.economyEventsMode || 'summary';
  const types = {};
  for (const t of TYPES) {
    const x = o.types?.[t.key] || {};
    types[t.key] = { on: t.required ? true : x.on !== false, channelId: snow(x.channelId) };
  }
  return {
    enabled: settings?.botEventsEnabled !== false && settings?.botEventsEnabled !== 0,
    channelId: snow(settings?.economyEventsChannelId),
    summary: typeof o.summary === 'boolean' ? o.summary : legacy === 'summary',
    each: typeof o.each === 'boolean' ? o.each : legacy === 'each',
    order: ORDERS.includes(o.order) ? o.order : 'summary-first',
    types
  };
}

/** Is this event posted at all (module on, the event's switch on)? */
function isOn(settings, key) {
  const r = read(settings);
  return r.enabled && Boolean(r.types[key]?.on);
}

/** The channel id this event goes to: its own, else the common one. */
function channelIdFor(settings, key) {
  const r = read(settings);
  return r.types[key]?.channelId || r.channelId;
}

/** Applies the events page form. `channelOk(id)` tells whether a channel belongs to the server. */
function applyForm(settings, body, channelOk = () => true) {
  const cur = read(settings);
  const ok = (v) => { const id = snow(v); return id && channelOk(id) ? id : null; };
  if (body.channelId !== undefined) settings.economyEventsChannelId = ok(body.channelId);
  const out = { summary: body.summary === 'on', each: body.each === 'on', order: ORDERS.includes(body.order) ? body.order : cur.order, types: {} };
  for (const t of TYPES) {
    out.types[t.key] = { on: t.required ? true : body[`on_${t.key}`] === 'on', channelId: ok(body[`ch_${t.key}`]) };
  }
  settings.botEvents = JSON.stringify(out);
}

/** In words, for the panel and the economy page: what happens when sections are switched on. */
function activationPlan(settings) {
  const r = read(settings);
  if (r.summary && r.each) return r.order === 'each-first' ? 'отдельное сообщение на каждый раздел, затем сводка' : 'сводка простыми словами, затем отдельное сообщение на каждый раздел';
  if (r.summary) return 'одно сообщение — сводка простыми словами';
  if (r.each) return 'отдельное сообщение на каждый раздел';
  return 'не объявляется';
}

module.exports = { TYPES, BY_KEY, ORDERS, read, isOn, channelIdFor, applyForm, activationPlan };
