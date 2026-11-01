// Russian → English for the bot and the panel. The code stays written in Russian; what goes out is translated on the way:
// every message, embed, button and modal the bot sends to a server whose language is English, and the panel pages for a viewer
// who chose English. The dictionary (i18n/en.json) is keyed by the Russian text as it stands in the code:
//   "Розыгрыш №{0} завершён."   — {0}, {1}… are the ${…} parts of a template string, they match any text;
//   "Добро пожаловать, {user}…" — {word} placeholders of the bot's own templates match any text too;
//   "Правила⟦0⟧…"               — ⟦n⟧ are tags/EJS outputs of panel templates (see templateUnits.js).
// A matched part that is itself Russian is translated again (it usually came from another string of the dictionary).
const { AsyncLocalStorage } = require('async_hooks');
const EN = require('./en.json');

const CYR = /[А-Яа-яЁё]/;
const LANGS = ['ru', 'en'];
const exact = new Map(Object.entries(EN));

// ---------- patterns ----------
const PH = /\{(\d+|[a-zA-Z]+)\}/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = [];
for (const [ru, en] of exact) {
  if (!PH.test(ru)) continue; PH.lastIndex = 0;
  const names = []; const lits = []; let last = 0; let m; let longest = '';
  while ((m = PH.exec(ru))) {
    const lit = ru.slice(last, m.index); lits.push(lit); if (lit.length > longest.length) longest = lit;
    names.push(m[1]); last = m.index + m[0].length;
  }
  const tail = ru.slice(last); if (tail.length > longest.length) longest = tail;
  if (!CYR.test(ru.replace(PH, ''))) continue; // a key that is only placeholders and punctuation would match anything
  // all groups lazy; when two placeholders touch ("{2}{3}") the split is ambiguous, so variants with one greedy group are kept too
  const build = (greedy) => new RegExp(`^${lits.map((l, i) => esc(l) + (i === greedy ? '([\\s\\S]*)' : '([\\s\\S]*?)')).join('')}${esc(tail)}$`);
  const touching = lits.slice(1).some((l) => l === '');
  const variants = [build(-1), ...(touching ? names.map((_, i) => build(i)) : [])];
  patterns.push({ re: variants[0], variants, names, en, longest, weight: ru.replace(PH, '').length });
}
patterns.sort((a, b) => b.weight - a.weight); // the most specific first

// Pieces for the last resort: known phrases inside a longer text built from several parts.
const fragments = [...exact.entries()].filter(([ru, en]) => ru.length >= 4 && !PH.test(ru) && !ru.includes('⟦') && CYR.test(ru) && en !== '')
  .sort((a, b) => b[0].length - a[0].length);
PH.lastIndex = 0;
// a phrase is not cut out of a longer word: the letter-boundary checks apply only at its ends that are letters
const bound = (ru) => `${/^[А-Яа-яЁё]/.test(ru) ? '(?<![А-Яа-яЁё])' : ''}${esc(ru)}${/[А-Яа-яЁё]$/.test(ru) ? '(?![А-Яа-яЁё])' : ''}`;
const fragRe = fragments.length ? new RegExp(fragments.map(([ru]) => bound(ru)).join('|'), 'g') : null;

const cache = new Map();
/**
 * English for one Russian text. `loose` also replaces known phrases inside a text that matches nothing as a whole
 * (used for the bot's own messages; never for names or text written by people).
 */
function toEnglish(text, loose = false, depth = 0) {
  if (typeof text !== 'string' || !CYR.test(text)) return text;
  const key = (loose ? '1' : '0') + text;
  const hit = cache.get(key); if (hit !== undefined) return hit;
  const res = translateNow(text, loose, depth);
  if (cache.size > 20000) cache.clear();
  cache.set(key, res);
  return res;
}
function translateNow(text, loose, depth) {
  const direct = exact.get(text); if (direct !== undefined) return direct;
  const trimmed = text.trim();
  if (trimmed !== text) { const t = exact.get(trimmed); if (t !== undefined) return text.replace(trimmed, t); }
  const spaced = exact.get(' ' + text); if (spaced !== undefined) return spaced.replace(/^ /, ''); // " (только боты)" glued to a neighbour
  if (depth < 4) {
    for (const p of patterns) {
      if (p.longest && !text.includes(p.longest)) continue;
      if (!p.re.test(text)) continue;
      const fill = (m) => p.en.replace(PH, (whole, name) => {
        const i = p.names.indexOf(name); if (i < 0) return whole;
        return toEnglish(m[i + 1], loose, depth + 1);
      });
      let best = null; let bestScore = Infinity;
      for (const re of p.variants) {
        const m = re.exec(text); if (!m) continue;
        const out = fill(m); const score = (out.match(/[А-Яа-яЁё]/g) || []).length;
        if (score < bestScore) { best = out; bestScore = score; }
        if (!score) break;
      }
      return best;
    }
    // several lines: each line on its own
    if (text.includes('\n')) { const lines = text.split('\n'); if (lines.length > 1) return lines.map((l) => toEnglish(l, loose, depth + 1)).join('\n'); }
  }
  // a sentence glued from several known parts: translate the parts between punctuation
  if (depth < 4) {
    const parts = text.split(/(\. |: |, | · | — | \| |\n)/);
    if (parts.length > 1) {
      const joined = parts.map((x, i) => (i % 2 ? x : toEnglish(x, false, depth + 1))).join('');
      if (joined !== text && !CYR.test(joined)) return joined;
      if (loose && joined !== text) {
        if (!fragRe) return joined;
        const a = loosen(text), b = loosen(joined); // whole known phrases may span the punctuation: try both ways
        const cyr = (x) => (x.match(/[А-Яа-яЁё]/g) || []).length;
        return cyr(a) <= cyr(b) ? a : b;
      }
    }
  }
  if (!loose || !fragRe) return text;
  return loosen(text);
}
// Last resort for the bot's own messages: known phrases, then the small words left between them.
const SMALL = { до: 'until', и: 'and', или: 'or', из: 'of', от: 'from', только: 'only', через: 'in', уже: 'already', ещё: 'more', на: 'for', в: 'in', за: 'for', нет: 'no', да: 'yes', не: 'not' };
const smallRe = new RegExp(`(?<![А-Яа-яЁё])(${Object.keys(SMALL).join('|')})(?![А-Яа-яЁё])`, 'g');
function loosen(text) {
  // quoted text (people's words) stays as it is: "> …" lines and code blocks
  return text.split(/(```[\s\S]*?```|^>.*$)/m).map((part, i) => {
    if (i % 2) return part;
    const known = part.replace(fragRe, (ru) => exact.get(ru) ?? ru);
    // small words only next to English: in a fully Russian phrase (a name, a reason someone typed) they stay
    return known === part ? part : known.replace(smallRe, (w, word, at, all) => (/[A-Za-z]/.test(all.slice(Math.max(0, at - 12), at + w.length + 12)) ? SMALL[word] : w));
  }).join('');
}

// ---------- which language ----------
const store = new AsyncLocalStorage();
const guildLangs = new Map(); // guildId -> 'ru' | 'en' | 'auto'
let clientRef = null;
const setClient = (c) => { clientRef = c; };
function setGuildLang(guildId, lang) { if (guildId) guildLangs.set(String(guildId), lang || 'auto'); }
/** The language the bot speaks on this server: the panel setting, or by the server's own language (Discord) when not chosen. */
function langOf(guildId) {
  if (!guildId) return null;
  const set = guildLangs.get(String(guildId));
  if (set === 'ru' || set === 'en') return set;
  if (set === undefined && !guildLangs.size) return 'ru';
  const loc = clientRef?.guilds?.cache?.get(String(guildId))?.preferredLocale;
  if (set === undefined) return 'ru'; // not loaded (a server added this second): Russian, as before
  return loc && !String(loc).startsWith('ru') && !String(loc).startsWith('uk') ? 'en' : 'ru';
}
const current = () => store.getStore() || null;
/** The language right now: of the server the current event is about, or Russian. */
function currentLang() { const c = current(); return c?.lang || langOf(c?.guildId) || 'ru'; }
const runWith = (ctx, fn) => store.run({ ...(current() || {}), ...ctx }, fn);

/** Text in the current (or given) language. For strings the bot puts into pictures and names. */
function t(text, lang = currentLang()) { return lang === 'en' ? toEnglish(text, true) : text; }

// ---------- payloads ----------
const TEXT_KEYS = ['content', 'title', 'description', 'label', 'placeholder', 'name', 'value', 'text'];
function deep(obj, lang, parentKey) {
  if (typeof obj === 'string') return toEnglish(obj, true);
  if (Array.isArray(obj)) return obj.map((x) => deep(x, lang, parentKey));
  if (!obj || typeof obj !== 'object') return obj;
  if (Buffer.isBuffer(obj) || obj instanceof Date) return obj;
  if (typeof obj.toJSON === 'function' && !obj.attachment && obj.constructor?.name !== 'Object') {
    const name = obj.constructor?.name || '';
    if (/Builder$/.test(name) || /Embed$/.test(name)) return deep(obj.toJSON(), lang, parentKey);
    return obj; // files, collections and other discord.js things go as they are
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'files' || k === 'attachments' || k === 'allowedMentions' || k === 'allowed_mentions' || k === 'reply' || k === 'poll' || k === 'url' || k === 'custom_id' || k === 'customId' || k === 'icon_url' || k === 'iconURL' || k === 'avatarURL' || k === 'proxy_url') { out[k] = v; continue; }
    if (typeof v === 'string') {
      // a text input's value is what the person typed earlier: leave it; a field's value is text
      const isInputValue = k === 'value' && (obj.type === 4 || obj.custom_id !== undefined);
      out[k] = !isInputValue && (TEXT_KEYS.includes(k) || k === 'username') ? toEnglish(v, true) : v;
    } else out[k] = deep(v, lang, k);
  }
  return out;
}
/** A message/reply/modal in the given language (Russian: untouched). */
function translatePayload(payload, lang) {
  if (lang !== 'en' || payload == null) return payload;
  if (typeof payload === 'string') return toEnglish(payload, true);
  if (typeof payload !== 'object') return payload;
  try { return deep(payload, lang); } catch { return payload; }
}

module.exports = { toEnglish, t, translatePayload, langOf, setGuildLang, setClient, currentLang, runWith, current, LANGS, CYR, exact, guildLangs };
