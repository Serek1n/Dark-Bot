// Заменители (as in Lacuna): templates in messages that the bot fills in when it sends them.
//
//   { member.display_name }                 a value (spaces inside the braces are allowed)
//   { member.nickname | member.username }  the first value that is not empty
//   { guild.description | "нет описания" }  …or a text in quotes
//   {- NUMDECL({ guild.member_count }; участник|участника|участников) -}   a function; arguments separated by ";"
//
// The old short forms ({user}, {name}, {server}, {count}, {level}, …) keep working: each place passes them as `legacy`.
// Unknown values are left as they were written, so a typo is visible instead of silently disappearing.
// Everything is plain text processing: no code from a template is ever run (MATH has its own tiny calculator).

const MAX_OUT = 4000;

// ---- values ----

/** Data about a member for templates (discord.js GuildMember, or a plain stand-in). */
function memberData(m, level = null) {
  if (!m) return null;
  const u = m.user || m;
  const voice = m.voice?.channel;
  return {
    id: m.id,
    mention: `<@${m.id}>`,
    username: u.username || '',
    display_name: m.displayName || u.globalName || u.username || '',
    nickname: m.nickname || null,
    avatar: typeof u.displayAvatarURL === 'function' ? u.displayAvatarURL({ extension: 'png', size: 256 }) : null,
    bot: Boolean(u.bot),
    created_at: u.createdTimestamp ?? null,
    joined_at: m.joinedTimestamp ?? null,
    premium_since: m.premiumSinceTimestamp ?? null,
    roles: rolesData(m.roles?.cache),
    voice: voice ? { id: voice.id, name: voice.name, mention: `<#${voice.id}>`, position: voice.position, full: Boolean(voice.full) } : null,
    level
  };
}

function rolesData(cache) {
  if (!cache) return {};
  const out = {};
  for (const r of cache.values()) if (r.name !== '@everyone') out[r.id] = roleData(r);
  return out;
}

function roleData(r) {
  return r ? { id: r.id, name: r.name, mention: `<@&${r.id}>`, color: r.hexColor || (r.color != null ? '#' + Number(r.color).toString(16).padStart(6, '0') : null), position: r.position, created_at: r.createdTimestamp ?? null } : null;
}

function channelData(c) {
  return c ? { id: c.id, name: c.name, mention: `<#${c.id}>`, type: c.type, position: c.position ?? null, parent_id: c.parentId ?? null } : null;
}

function guildData(g) {
  if (!g) return null;
  const owner = g.members?.cache?.get?.(g.ownerId);
  const channels = {};
  for (const c of g.channels?.cache?.values?.() || []) channels[c.id] = channelData(c);
  const acronym = String(g.name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('');
  return {
    id: g.id,
    name: g.name,
    name_acronym: g.nameAcronym || acronym,
    icon: typeof g.iconURL === 'function' ? g.iconURL({ extension: 'png', size: 256 }) : null,
    banner: typeof g.bannerURL === 'function' ? g.bannerURL({ size: 1024 }) : null,
    description: g.description || null,
    member_count: g.memberCount ?? null,
    presence_count: g.approximatePresenceCount ?? null,
    boost_tier: g.premiumTier ?? 0,
    booster_count: g.premiumSubscriptionCount ?? 0,
    created_at: g.createdTimestamp ?? null,
    vanity_url: g.vanityURLCode ? `https://discord.gg/${g.vanityURLCode}` : null,
    afk_channel_id: g.afkChannelId || null,
    rules_channel_id: g.rulesChannelId || null,
    system_channel_id: g.systemChannelId || null,
    channels,
    owner: owner ? { username: owner.user?.username, display_name: owner.displayName, nickname: owner.nickname || null, mention: `<@${owner.id}>`, avatar: owner.user?.displayAvatarURL?.() || null } : { mention: g.ownerId ? `<@${g.ownerId}>` : null }
  };
}

function messageData(msg) {
  if (!msg) return null;
  const words = String(msg.content || '').trim().split(/\s+/).filter(Boolean);
  return {
    id: msg.id,
    content: msg.content || '',
    url: msg.url || null,
    created_at: msg.createdTimestamp ?? null,
    edited_at: msg.editedTimestamp ?? null,
    channel: channelData(msg.channel),
    args: Object.assign(words.slice(1), { all: words.slice(1).join(' ') }),
    mentions: {
      members: [...(msg.mentions?.members?.values?.() || [])].map((m) => memberData(m)),
      roles: [...(msg.mentions?.roles?.values?.() || [])].map(roleData),
      channels: [...(msg.mentions?.channels?.values?.() || [])].map(channelData)
    }
  };
}

/** The context for a template from what is at hand. Every field is optional. */
function buildContext({ member, guild, channel, role, message, level, subs, extra } = {}) {
  const g = guild || member?.guild || message?.guild || null;
  return {
    member: memberData(member, level || null),
    guild: guildData(g),
    channel: channelData(channel || message?.channel),
    role: roleData(role),
    message: messageData(message),
    subs: subs || null,
    ...(extra || {})
  };
}

/** The value at a path like "member.roles.123.name" (null when any step is missing). */
function lookup(ctx, path) {
  let v = ctx;
  for (const key of path.split('.')) {
    if (v == null) return null;
    v = Array.isArray(v) && /^\d+$/.test(key) ? v[Number(key)] : Object.prototype.hasOwnProperty.call(Object(v), key) ? v[key] : undefined;
    if (v === undefined) return undefined; // unknown name: the template is left as written
  }
  return v;
}

const show = (v) => (v == null ? '' : typeof v === 'object' ? (v.mention || v.name || '') : String(v));

// ---- functions ----

const MONTHS = {
  ru: { long: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'], short: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'], days: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'] },
  en: { long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }
};

/** DATE(date?; format?; utc_offset?; locale?) — format tokens YYYY YY MMMM MMM MM M DD D dddd HH H mm ss, [text] as is. */
function formatDate(dateArg, format = 'DD MMMM YYYY HH:mm', offset = '+03:00', locale = 'ru') {
  const ms = dateArg === undefined || dateArg === '' ? Date.now() : Number(dateArg);
  if (!Number.isFinite(ms)) throw new Error('неверная дата');
  const off = String(offset || '+00:00').match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (!off) throw new Error('неверный часовой пояс');
  const shift = (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] || 0)) * 60000;
  const d = new Date(ms + shift);
  const L = MONTHS[String(locale).toLowerCase()] || MONTHS.ru;
  const p2 = (n) => String(n).padStart(2, '0');
  const tokens = {
    YYYY: d.getUTCFullYear(), YY: p2(d.getUTCFullYear() % 100), MMMM: L.long[d.getUTCMonth()], MMM: L.short[d.getUTCMonth()], MM: p2(d.getUTCMonth() + 1), M: d.getUTCMonth() + 1,
    DD: p2(d.getUTCDate()), D: d.getUTCDate(), dddd: L.days[d.getUTCDay()], HH: p2(d.getUTCHours()), H: d.getUTCHours(), mm: p2(d.getUTCMinutes()), ss: p2(d.getUTCSeconds())
  };
  return String(format || 'DD MMMM YYYY HH:mm').replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|HH|H|mm|ss/g, (t, lit) => (lit !== undefined ? lit : String(tokens[t])));
}

/** MATH: + - * / % ^ and brackets over numbers. A tiny parser — nothing from the template is executed. */
function calc(expr) {
  const s = String(expr).replace(/\s+/g, '').replace(/,/g, '.');
  if (!s || s.length > 200 || /[^0-9.+\-*/%^()]/.test(s)) throw new Error('неверное выражение');
  let i = 0;
  const peek = () => s[i];
  function number() {
    const m = s.slice(i).match(/^\d+(\.\d+)?|^\.\d+/);
    if (!m) throw new Error('неверное выражение');
    i += m[0].length; return Number(m[0]);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = sum(); if (s[i++] !== ')') throw new Error('нет скобки'); return v; }
    return number();
  }
  function power() { const b = factor(); if (peek() === '^') { i++; return b ** power(); } return b; }
  function product() {
    let v = power();
    while (['*', '/', '%'].includes(peek())) { const op = s[i++]; const r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const v = sum();
  if (i !== s.length || !Number.isFinite(v)) throw new Error('неверное выражение');
  return v;
}

/** NUMDECL(5; участник|участника|участников) → "участников" (Russian plural rules; en: one|many). */
function numdecl(n, titles, lang = 'ru') {
  const forms = String(titles || '').split('|');
  const x = Math.abs(Math.trunc(Number(n)));
  if (!Number.isFinite(x)) throw new Error('не число');
  if (String(lang).toLowerCase() === 'en') return forms[x === 1 ? 0 : 1] ?? forms[0];
  const i = x % 100 > 10 && x % 100 < 20 ? 2 : [2, 0, 1, 1, 1, 2][Math.min(x % 10, 5)];
  return forms[i] ?? forms[forms.length - 1] ?? '';
}

const FUNCTIONS = {
  CHOOSE: (...a) => a[Math.floor(Math.random() * a.length)] ?? '',
  DATE: (d, f, o, l) => formatDate(d, f || undefined, o || undefined, l || undefined),
  DATENOW: () => String(Date.now()),
  FIXNUM: (n, digits = '0') => { const v = Number(n); if (!Number.isFinite(v)) throw new Error('не число'); return v.toFixed(Math.min(20, Math.max(0, Number(digits) || 0))); },
  LOWER: (s = '') => s.toLowerCase(),
  UPPER: (s = '') => s.toUpperCase(),
  TRIM: (s = '') => s.trim(),
  MATH: (e, digits = '0') => calc(e).toFixed(Math.min(20, Math.max(0, Number(digits) || 0))),
  NUMDECL: (n, t, l) => numdecl(n, t, l),
  RANDOM: (a = '0', b = '100') => { const lo = Math.ceil(Number(a)), hi = Math.floor(Number(b)); if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new Error('неверный диапазон'); return String(lo + Math.floor(Math.random() * (hi - lo + 1))); },
  // the search text is taken literally (not a regular expression: a template must not be able to hang the bot)
  REPLACE: (s = '', search = '', repl = '', flags = '') => (!search ? s : flags.includes('g') ? s.split(search).join(repl) : s.replace(search, () => repl)),
  TRUNCATE: (s = '', limit = '100', end = '...') => { const n = Math.max(0, Number(limit) || 0); return s.length > n ? s.slice(0, n) + end : s; }
};

/** Splits "a; b; c" at top-level semicolons. */
function splitArgs(text) {
  const out = []; let cur = ''; let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ---- rendering ----

const VALUE_RE = /\{\s*([A-Za-z_][\w]*(?:\.[\w]+)*(?:\s*\|\s*(?:"[^"{}]*"|[A-Za-z_][\w]*(?:\.[\w]+)*))*)\s*\}/g;
const FUNC_RE = /\{-\s*([A-Z]+)\(((?:(?!\{-)[\s\S])*?)\)\s*-\}/g; // innermost first: no "{-" inside

function replaceValues(text, ctx) {
  return text.replace(VALUE_RE, (whole, expr) => {
    const options = expr.split('|').map((x) => x.trim());
    let known = false;
    for (const opt of options) {
      if (opt.startsWith('"')) return opt.slice(1, -1);
      const v = lookup(ctx, opt);
      if (v !== undefined) known = true;
      if (v != null && v !== '') return show(v);
    }
    return known ? '' : whole; // a real but empty value prints nothing; an unknown name stays visible
  });
}

/**
 * Fills in a template. `ctx` from buildContext(); `legacy` — the old short forms of this place, e.g. { user: '<@1>', name: 'Ann' }.
 */
function render(template, ctx = {}, legacy = {}) {
  let text = String(template ?? '');
  for (const [k, v] of Object.entries(legacy)) text = text.split(`{${k}}`).join(v == null ? '' : String(v));
  text = replaceValues(text, ctx);
  for (let pass = 0; pass < 10 && text.includes('{-'); pass++) {
    const before = text;
    text = text.replace(FUNC_RE, (whole, name, args) => {
      const fn = FUNCTIONS[name];
      if (!fn) return `[${name}: нет такой функции]`;
      try {
        return String(fn(...splitArgs(args)));
      } catch (err) {
        return `[${name}: ${err.message}]`;
      }
    });
    if (text === before) break;
  }
  return text.slice(0, MAX_OUT);
}

/** For the panel: the names one can use, with short descriptions. */
const REFERENCE = {
  values: [
    ['member.mention', 'упоминание участника'], ['member.display_name', 'имя на сервере'], ['member.username', 'логин'], ['member.avatar', 'ссылка на аватар'],
    ['member.joined_at', 'когда зашёл (мс)'], ['member.created_at', 'когда создан аккаунт (мс)'], ['member.voice.name', 'голосовой канал участника'],
    ['member.level.level', 'уровень'], ['member.level.total_xp', 'весь опыт'], ['member.level.rank', 'место в рейтинге'],
    ['guild.name', 'название сервера'], ['guild.member_count', 'участников'], ['guild.booster_count', 'бустов'], ['guild.owner.mention', 'владелец'], ['guild.icon', 'иконка сервера'],
    ['channel.mention', 'канал'], ['message.args.0', 'первое слово после команды'], ['message.args.all', 'всё после команды']
  ],
  functions: [
    ['NUMDECL({ guild.member_count }; участник|участника|участников)', 'склонение по числу'],
    ['CHOOSE(Привет; Здравствуй; Хей)', 'случайный вариант'],
    ['DATE({ member.joined_at }; DD MMMM YYYY)', 'дата'], ['MATH({ guild.member_count } * 2)', 'вычисление'],
    ['RANDOM(1; 100)', 'случайное число'], ['UPPER(текст)', 'ЗАГЛАВНЫЕ'], ['TRUNCATE(текст; 20)', 'обрезать']
  ]
};

module.exports = { render, buildContext, memberData, guildData, channelData, roleData, messageData, formatDate, calc, numdecl, FUNCTIONS, REFERENCE };
