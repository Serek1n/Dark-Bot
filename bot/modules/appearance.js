// «Оформление»: how the bot's messages look on a server. One theme for everything (the colours of the picture cards and of
// the frames of messages) and, for each kind of message, what it is made of: a picture card, a text, or both — these are
// independent switches, not "one or the other" — plus whether the text sits in a frame and the headline of the card.
// Stored as JSON in GuildSettings.appearance; the panel page is web/views/dashboard/appearance.ejs.

// The themes: the colours of a picture card. accent is the main colour (bars, frames, highlights, the frame of a message).
const THEMES = {
  dark: { title: 'DARK', desc: 'Тёмный с золотом — как было', accent: '#e3a857', bg: '#14161b', panel: '#1a1c22', raised: '#1f2229', hairline: '#2a2d35', paper: '#ece8e0', fog: '#9498a0' },
  violet: { title: 'Фиалка', desc: 'Тёмно-синий с сиреневым', accent: '#9a93ff', bg: '#12121b', panel: '#191925', raised: '#20202e', hairline: '#2c2b3e', paper: '#ecebf5', fog: '#9997ad' },
  neon: { title: 'Неон', desc: 'Ночной закат: розовый и бирюза', accent: '#ff5fae', bg: '#140a22', panel: '#1d1030', raised: '#28163f', hairline: '#3b2457', paper: '#fbeefc', fog: '#c3a6d2' },
  ocean: { title: 'Океан', desc: 'Глубокий синий с бирюзой', accent: '#3fc6d8', bg: '#0b141a', panel: '#101c24', raised: '#15242e', hairline: '#203440', paper: '#e6f2f5', fog: '#8fa6b0' },
  forest: { title: 'Лес', desc: 'Тёмно-зелёный с мятным', accent: '#5cc98f', bg: '#0e1511', panel: '#141d17', raised: '#1a251e', hairline: '#25352b', paper: '#e8f1ea', fog: '#93a69a' },
  crimson: { title: 'Рубин', desc: 'Почти чёрный с красным', accent: '#ef5b5b', bg: '#150d0e', panel: '#1d1314', raised: '#26191a', hairline: '#382325', paper: '#f5e9e9', fog: '#ad9597' },
  graphite: { title: 'Графит', desc: 'Строгий серый без цвета', accent: '#d4d7de', bg: '#111214', panel: '#18191c', raised: '#1e2023', hairline: '#2b2d31', paper: '#eeeff1', fog: '#94979e' },
  light: { title: 'Светлая', desc: 'Белая карточка с тёплым акцентом', accent: '#c2671f', bg: '#f6f3ee', panel: '#ffffff', raised: '#f0ebe3', hairline: '#e2dacd', paper: '#1d1b18', fog: '#6b655c' }
};

// The kinds of messages a server can shape. card / text: what is on by default; frame: the text sits in a frame (embed);
// headline: the big line of the picture (null: the card has none to change); canCard: the kind has a picture at all.
const TARGETS = [
  { key: 'levelUp', module: 'leveling', title: 'Новый уровень', desc: 'Поздравление, когда участник поднимает уровень', card: false, text: true, frame: true, headline: 'НОВЫЙ УРОВЕНЬ', cardLabel: 'Карточка уровня', textLabel: 'Текст поздравления', formats: { classic: '900 × 260', wide: '1140 × 302' } },
  { key: 'profile', module: 'leveling', title: 'Профиль /profile', desc: 'Карточка участника: уровень, место, опыт, валюта', card: true, text: false, frame: true, headline: null, cardLabel: 'Карточка профиля', textLabel: 'Профиль текстом' },
  { key: 'top', module: 'leveling', title: 'Таблица лидеров /top', desc: 'Лучшие участники сервера по опыту, голосу и богатству', card: true, text: false, frame: true, headline: null, cardLabel: 'Таблица картинкой', textLabel: 'Список текстом' },
  { key: 'achievement', module: 'achievements', title: 'Достижение открыто', desc: 'Сообщение, когда участник получает достижение', card: true, text: true, frame: true, headline: 'ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!', cardLabel: 'Карточка достижения', textLabel: 'Текст с наградой', formats: { classic: '900 × 300', wide: '1140 × 302' } },
  { key: 'fun', module: 'fun', title: 'Мини-игры', desc: 'Ответы /dice, /coinflip, /8ball и /rps', card: false, text: true, frame: true, headline: null, cardLabel: 'Картинка результата', textLabel: 'Текст результата' },
  { key: 'voicePanel', module: 'tempVoice', title: 'Панель комнаты', desc: 'Сообщение с кнопками управления временной комнатой', card: true, text: true, frame: true, headline: 'Управление комнатой', cardLabel: 'Свои значки', textLabel: 'Подписи разделов', labels: false }
];
const BY_KEY = new Map(TARGETS.map((t) => [t.key, t]));

// The shapes of a picture card (for the kinds that have `formats`). «Широкий» follows MEE6's banner: 1140 × 302 with empty
// space around the plate — 16 px at the top and left (5.3 % of the height, 1.4 % of the width), 31 px at the bottom and
// right (1.9375 times more, room for the shadow): about 3.77 : 1 with the space and 4.29 : 1 for the plate itself.
const FORMATS = {
  classic: { title: 'Классический', desc: 'карточка во всю картинку' },
  wide: { title: 'Широкий', desc: 'плашка с тенью и прозрачными полями' }
};
const formatsOf = (key) => Object.keys(BY_KEY.get(key)?.formats || {});

const HEX = /^#[0-9a-f]{6}$/i;
const parse = (raw) => { if (raw && typeof raw === 'object') return raw; try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const clean = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/** The server's look, every field filled in. */
function read(settings) {
  const raw = parse(settings?.appearance);
  const theme = THEMES[raw.theme] ? raw.theme : 'dark';
  const accent = HEX.test(raw.accent || '') ? raw.accent.toLowerCase() : null;
  const targets = {};
  for (const t of TARGETS) {
    const r = raw.targets?.[t.key] || {};
    let card = typeof r.card === 'boolean' ? r.card : t.card;
    let text = typeof r.text === 'boolean' ? r.text : t.text;
    if (!card && !text) text = true; // a message can't be made of nothing
    targets[t.key] = {
      card, text,
      // the frame of the level-up message is the same switch as «В рамке» on the «Уровни» page
      frame: t.key === 'levelUp' && settings && settings.levelUpEmbed !== undefined ? settings.levelUpEmbed !== false : typeof r.frame === 'boolean' ? r.frame : t.frame,
      headline: t.headline === null ? null : clean(r.headline, 60) || null,
      ...(t.formats ? { format: t.formats[r.format] ? r.format : 'classic' } : {}),
      ...(t.key === 'voicePanel' ? { labels: typeof r.labels === 'boolean' ? r.labels : false, intro: clean(r.intro, 300) || null } : {})
    };
  }
  return { theme, accent, targets };
}

/**
 * Saves a form of the panel into the settings (not saved to the database here). The theme changes only when the form has
 * it; `keys` limits the kinds of messages this form is about (each tab of the page has its own), the rest stay as they are.
 */
function applyForm(settings, body = {}, keys = null) {
  const cur = read(settings);
  const out = { theme: cur.theme, accent: cur.accent, targets: {} };
  if ('theme' in body) {
    out.theme = THEMES[body.theme] ? body.theme : 'dark';
    out.accent = body.accentOn === 'on' && HEX.test(String(body.accent || '')) ? String(body.accent).toLowerCase() : null;
  }
  for (const t of TARGETS) {
    if (keys && !keys.includes(t.key)) { out.targets[t.key] = cur.targets[t.key]; continue; }
    const p = (k) => body[`${t.key}_${k}`];
    const card = p('card') === 'on'; let text = p('text') === 'on';
    if (!card && !text) text = true;
    out.targets[t.key] = { card, text, frame: p('frame') === 'on' };
    if (t.headline !== null) out.targets[t.key].headline = clean(p('headline'), 60) || null;
    if (t.formats) out.targets[t.key].format = t.formats[p('format')] ? p('format') : 'classic';
    if (t.key === 'voicePanel') { out.targets[t.key].labels = p('labels') === 'on'; out.targets[t.key].intro = clean(p('intro'), 300) || null; }
  }
  settings.appearance = JSON.stringify(out);
  if (!keys || keys.includes('levelUp')) settings.levelUpEmbed = out.targets.levelUp.frame; // the same switch as «В рамке» on the «Уровни» page
  return out;
}

// ---- colours ----
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, k) => { const x = toRgb(a); const y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * k)); };
const isLight = (hex) => { const [r, g, b] = toRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150; };

/** The colours of a picture card in this look (the same keys as rankCard's COLORS). */
function palette(look) {
  const th = THEMES[look?.theme] || THEMES.dark;
  const accent = look?.accent || th.accent;
  const light = isLight(th.bg);
  return {
    bg: th.bg, panel: th.panel, raised: th.raised, hairline: th.hairline, paper: th.paper, fog: th.fog,
    ember: accent, emberDeep: mix(accent, '#000000', 0.18), emberLight: light ? mix(accent, '#000000', 0.12) : mix(accent, '#ffffff', 0.28),
    track: light ? mix(th.raised, '#000000', 0.06) : mix(th.raised, '#ffffff', 0.03),
    silver: light ? '#8a8f99' : '#b9bcc4', bronze: '#c08a5b', light
  };
}

/** The colour of the frame of a message (an embed's side line) in this look. */
const embedColor = (look) => parseInt((look?.accent || (THEMES[look?.theme] || THEMES.dark).accent).slice(1), 16);

/** One kind of message in this look: { card, text, frame, headline, ... }. */
const target = (look, key) => (look?.targets || read(null).targets)[key] || read(null).targets[key];

// The bot reads the look of a server often (every level-up, every /dice): kept for a minute, dropped when the panel saves.
const cache = new Map();
async function forGuild(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < 60_000) return hit.look;
  const row = await require('../../db').GuildSettings.findOne({ where: { guildId }, attributes: ['guildId', 'appearance'] }).catch(() => null);
  const look = read(row);
  cache.set(guildId, { at: Date.now(), look });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return look;
}
const forget = (guildId) => cache.delete(guildId);

module.exports = { THEMES, TARGETS, BY_KEY, FORMATS, formatsOf, read, applyForm, palette, embedColor, target, forGuild, forget, mix };
