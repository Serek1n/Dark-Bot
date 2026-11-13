// The economy's sections and how a server picks them. Three ways:
//   simple  — the base only (coins, crystals, /daily, /pay, the shop); nothing else changes. The default.
//   preset  — a ready set of sections; the admin chooses which of them to fine-tune (the rest keep their defaults).
//   custom  — the admin opens the sections he wants and switches the functions on one by one, with their numbers.
// The journal of operations and the /balance card are always there: they change nothing for anyone.

/** Every section: its words (also used to announce it in Discord) and its numbers with limits and defaults. */
const FEATURES = [
  {
    key: 'protect', title: 'Защита от накрутки', group: 'base',
    short: 'Переводы новичкам приходят с задержкой, у переводов есть дневной лимит',
    announce: 'Защита от накрутки: у переводов есть дневной лимит, а деньги новичкам приходят с задержкой — так сложнее перекачивать монеты через вторые аккаунты.',
    params: [
      { key: 'payDailyLimit', label: 'Лимит переводов в сутки на человека', unit: 'монет', min: 0, max: 1e9, def: 10000, hint: '0 — без лимита' },
      { key: 'newbieDays', label: 'Новичок — меньше дней на сервере', unit: 'дн.', min: 0, max: 60, def: 3 },
      { key: 'newbieLevel', label: 'Или уровень ниже', min: 0, max: 100, def: 2 },
      { key: 'holdHours', label: 'Перевод новичку приходит через', unit: 'ч', min: 1, max: 168, def: 24 }
    ]
  },
  {
    key: 'bank', title: 'Центробанк', group: 'unique',
    short: 'Следит за количеством денег и сам подстраивает награды',
    announce: 'Центробанк: бот следит, сколько монет на сервере, и сам плавно подстраивает награды за чат, голос и /daily, чтобы монеты не обесценивались.',
    params: [
      { key: 'inflationTarget', label: 'Инфляция не выше, в неделю', unit: '%', min: 1, max: 100, def: 5 },
      { key: 'autoRate', label: 'Подстраивать награды автоматически', type: 'bool', def: true },
      { key: 'minRate', label: 'Награды не ниже', unit: '% от обычных', min: 10, max: 100, def: 25 }
    ]
  },
  {
    key: 'treasury', title: 'Казна и налоги', group: 'unique',
    short: 'Налог с переводов, покупок и сделок идёт в казну, её тратят голосованием',
    announce: 'Казна сервера: с переводов, покупок и сделок берётся небольшой налог. Куда потратить казну — раздачу, призовой фонд или общую цель — решаем голосованием.',
    params: [
      { key: 'payTax', label: 'Налог с переводов', unit: '%', min: 0, max: 50, def: 5 },
      { key: 'shopTax', label: 'Налог с покупок в магазине', unit: '%', min: 0, max: 50, def: 5 },
      { key: 'dealTax', label: 'Налог со сделок', unit: '%', min: 0, max: 50, def: 5 }
    ]
  },
  {
    key: 'goals', title: 'Общие цели', group: 'unique',
    short: 'Сервер вместе копит на награду: буст опыта, роль, событие',
    announce: 'Общие цели: копим всем сервером на награду — например, неделю двойного опыта или новую роль. Если к сроку не соберём, все деньги вернутся.',
    params: [{ key: 'maxOpen', label: 'Целей одновременно, не больше', min: 1, max: 10, def: 3 }]
  },
  {
    key: 'deals', title: 'Сделки с гарантом', group: 'unique',
    short: '/deal: бот держит деньги, пока обе стороны не подтвердят',
    announce: 'Сделки с гарантом: команда /deal. Бот замораживает деньги покупателя и отдаёт их продавцу, только когда оба подтвердят, что всё выполнено. Если спорите — решит модератор.',
    params: [{ key: 'acceptHours', label: 'Продавец должен принять сделку за', unit: 'ч', min: 1, max: 168, def: 24 }]
  },
  {
    key: 'work', title: 'Работа', group: 'usual',
    short: '/work с откатом, награда растёт с уровнем',
    announce: 'Работа: команда /work. Смена раз в {cooldownMin} мин., чем выше уровень, тем больше платят. Никаких азартных игр.',
    params: [
      { key: 'cooldownMin', label: 'Откат', unit: 'мин', min: 5, max: 1440, def: 60 },
      { key: 'min', label: 'Награда от', unit: 'монет', min: 0, max: 1e6, def: 20 },
      { key: 'max', label: 'до', unit: 'монет', min: 0, max: 1e6, def: 60 },
      { key: 'perLevel', label: 'Прибавка за каждый уровень', unit: 'монет', min: 0, max: 1e5, def: 2 }
    ]
  },
  {
    key: 'gifts', title: 'Подарочные коды', group: 'usual',
    short: '/gift: одноразовый код на сумму, который можно отдать кому угодно',
    announce: 'Подарочные коды: /gift create делает одноразовый код на сумму из вашего баланса, /gift redeem забирает подарок по коду.',
    params: [
      { key: 'maxPerDay', label: 'Кодов в сутки на человека', min: 1, max: 50, def: 5 },
      { key: 'minAmount', label: 'Сумма кода от', unit: 'монет', min: 1, max: 1e6, def: 10 }
    ]
  },
  {
    key: 'wealthTop', title: 'Топ по богатству', group: 'usual',
    short: 'Вкладка «Богатство» в /top',
    announce: 'Топ по богатству: в /top появилась вкладка «Богатство».',
    params: []
  },
  {
    key: 'seasons', title: 'Сезоны', group: 'usual',
    short: 'Раз в N месяцев монеты обнуляются, лучшим — значок в профиль',
    announce: 'Сезоны: раз в {months} мес. монеты обнуляются, а лучшие {top} по богатству получают значок в профиль. Кристаллы и роли остаются.',
    params: [
      { key: 'months', label: 'Длина сезона', unit: 'мес.', min: 1, max: 12, def: 3 },
      { key: 'top', label: 'Значки получают первые', unit: 'мест', min: 1, max: 10, def: 3 }
    ]
  }
];
const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
const KEYS = FEATURES.map((f) => f.key);

const PRESETS = [
  { key: 'calm', title: 'Спокойный сервер', desc: 'Немного больше, чем база: работа, подарки, топ по богатству и защита от накрутки.', features: ['protect', 'work', 'gifts', 'wealthTop'] },
  { key: 'community', title: 'Активное сообщество', desc: 'Всё из «Спокойного» плюс казна с налогами и общие цели сервера.', features: ['protect', 'work', 'gifts', 'wealthTop', 'treasury', 'goals'] },
  { key: 'full', title: 'Полная экономика', desc: 'Всё сразу: центробанк, сделки с гарантом и сезоны в придачу.', features: KEYS.slice() }
];
const PRESET_BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
const MODES = ['simple', 'preset', 'custom'];
const EVENT_MODES = ['each', 'summary', 'quiet'];

function parse(text) { try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }

/** Which sections are on for a server right now (none when the economy module itself is off). */
function enabledKeys(settings) {
  if (!settings || settings.economyEnabled === false) return [];
  const mode = MODES.includes(settings.economyMode) ? settings.economyMode : 'simple';
  if (mode === 'simple') return [];
  if (mode === 'preset') return (PRESET_BY_KEY[settings.economyPreset] || PRESETS[0]).features.slice();
  const flags = parse(settings.economyFeatures);
  return KEYS.filter((k) => flags[k] === true);
}
const isOn = (settings, key) => enabledKeys(settings).includes(key);

/** A section's numbers: what the admin saved, inside its limits, or the default. */
function params(settings, key) {
  const all = parse(settings && settings.economyParams);
  const saved = all[key] || {};
  const out = {};
  for (const p of (BY_KEY[key] || { params: [] }).params) {
    if (p.type === 'bool') out[p.key] = saved[p.key] === undefined ? p.def : saved[p.key] === true;
    else { const n = Math.trunc(Number(saved[p.key])); out[p.key] = Number.isFinite(n) && saved[p.key] !== '' && saved[p.key] !== null && saved[p.key] !== undefined ? Math.min(p.max, Math.max(p.min, n)) : p.def; }
  }
  if (key === 'work' && out.max < out.min) out.max = out.min;
  return out;
}

/**
 * Reads the settings form (web panel). body: mode, preset, f_<key>=on (custom), tune_<key>=on (preset: which sections to set up),
 * p_<key>_<param> (the numbers), eventsChannelId, eventsMode. Returns the keys that were switched on by this save.
 */
function applyForm(settings, body) {
  const before = enabledKeys(settings);
  const mode = MODES.includes(body.mode) ? body.mode : 'simple';
  settings.economyMode = mode;
  if (PRESET_BY_KEY[body.preset]) settings.economyPreset = body.preset;
  if (mode === 'custom') settings.economyFeatures = JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, body[`f_${k}`] === 'on' || body[`f_${k}`] === '1'])));
  // Numbers: in "custom" every switched-on section; in "preset" only the sections ticked "set up" (the others keep theirs)
  const all = parse(settings.economyParams);
  const tunable = mode === 'custom' ? KEYS.filter((k) => body[`f_${k}`] === 'on' || body[`f_${k}`] === '1')
    : mode === 'preset' ? (PRESET_BY_KEY[settings.economyPreset] || PRESETS[0]).features.filter((k) => (body.tune__present !== undefined || body[`tune_${k}`] !== undefined ? body[`tune_${k}`] === 'on' : true)) : [];
  for (const key of tunable) {
    const f = BY_KEY[key]; if (!f.params.length) continue;
    const cur = all[key] || {};
    for (const p of f.params) {
      const name = `p_${key}_${p.key}`;
      if (p.type === 'bool') { if (body[`${name}__present`] !== undefined || body[name] !== undefined) cur[p.key] = body[name] === 'on' || body[name] === '1'; continue; }
      if (body[name] === undefined || body[name] === '') continue;
      const n = Math.trunc(Number(body[name]));
      if (Number.isFinite(n)) cur[p.key] = Math.min(p.max, Math.max(p.min, n));
    }
    all[key] = cur;
  }
  settings.economyParams = JSON.stringify(all);
  if (body.eventsChannelId !== undefined) settings.economyEventsChannelId = /^\d{15,25}$/.test(String(body.eventsChannelId)) ? String(body.eventsChannelId) : null;
  if (EVENT_MODES.includes(body.eventsMode)) settings.economyEventsMode = body.eventsMode;
  const after = enabledKeys(settings);
  return { added: after.filter((k) => !before.includes(k)), removed: before.filter((k) => !after.includes(k)) };
}

/** A section's announcement with its numbers filled in. */
function announceText(settings, key) {
  const p = params(settings, key);
  return BY_KEY[key].announce.replace(/\{(\w+)\}/g, (_, k) => (p[k] !== undefined ? p[k] : ''));
}

module.exports = { FEATURES, BY_KEY, KEYS, PRESETS, PRESET_BY_KEY, MODES, EVENT_MODES, enabledKeys, isOn, params, applyForm, announceText, parse };
