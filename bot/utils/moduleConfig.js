// The settings of a module that are more than a few columns (tickets, polls, mini-games, reminders, the bot's branding,
// where each module works): one JSON column of guild_settings per module, described here once. The bot reads them with
// read(settings, key) — every field with its default, whatever is stored; the panel saves them with fromForm(key, body)
// — the form's fields checked and cleaned, the errors by field.
//
// Field types: bool · json (an object the page builds itself) · int (min, max) · str (max, required) · lines (a list of short texts, one per line; max items, len)
// · enum (values) · id (a Discord ID) · ids (several, max) · hex (a colour #rrggbb or empty) · list (item: fields, max).
// A list in a form is sent as `${name}_${i}_${field}` (a list inside a list: `${name}_${i}_${sub}_${j}_${field}`).

const SNOW = /^\d{15,25}$/;
const HEX = /^#?[0-9a-f]{6}$/i;

const SPECS = {
  tickets: {
    column: 'ticketConfig',
    fields: {
      maxOpen: { type: 'int', min: 1, max: 5, def: 1 },
      nameFormat: { type: 'str', max: 60, def: 'обращение-{number}-{user}' },
      supportRoles: { type: 'ids', max: 10, def: [] },
      autoCloseHours: { type: 'int', min: 0, max: 720, def: 0 },
      warnHours: { type: 'int', min: 0, max: 168, def: 12 },
      transcript: { type: 'enum', values: ['txt', 'html', 'off'], def: 'txt' },
      rating: { type: 'bool', def: false },
      blacklist: { type: 'ids', max: 200, def: [] },
      panelChannelId: { type: 'id', def: null },
      panelMessageId: { type: 'id', def: null },
      panelButton: { type: 'str', max: 80, def: 'Создать обращение' },
      panelEmbed: { type: 'json', def: null }, // the embed of the panel message (partials/embed-editor.ejs, saved by the page)
      categories: {
        type: 'list', max: 10, def: [],
        item: {
          label: { type: 'str', max: 45, required: true },
          emoji: { type: 'str', max: 32, def: '' },
          description: { type: 'str', max: 100, def: '' },
          roles: { type: 'ids', max: 5, def: [] },
          welcome: { type: 'str', max: 1000, def: '' },
          questions: { type: 'list', max: 5, def: [], item: { label: { type: 'str', max: 45, required: true }, long: { type: 'bool', def: false }, required: { type: 'bool', def: true } } }
        }
      }
    }
  },
  polls: {
    column: 'pollConfig',
    fields: {
      creatorRoles: { type: 'ids', max: 10, def: [] },
      defaultMinutes: { type: 'int', min: 0, max: 43200, def: 0 },
      maxDays: { type: 'int', min: 1, max: 30, def: 30 },
      maxOptions: { type: 'int', min: 2, max: 10, def: 10 },
      multi: { type: 'bool', def: true },
      anonymous: { type: 'bool', def: true },
      thread: { type: 'bool', def: false },
      color: { type: 'hex', def: '' },
      resultColor: { type: 'hex', def: '' },
      barFull: { type: 'str', max: 2, def: '█' },
      barEmpty: { type: 'str', max: 2, def: '░' },
      footer: { type: 'str', max: 100, def: '' }
    }
  },
  fun: {
    column: 'funConfig',
    fields: {
      dice: { type: 'bool', def: true },
      coinflip: { type: 'bool', def: true },
      '8ball': { type: 'bool', def: true },
      rps: { type: 'bool', def: true },
      cooldownSec: { type: 'int', min: 0, max: 3600, def: 0 },
      ephemeral: { type: 'bool', def: false },
      answersGood: { type: 'lines', max: 40, len: 100, def: [] },
      answersMaybe: { type: 'lines', max: 40, len: 100, def: [] },
      answersBad: { type: 'lines', max: 40, len: 100, def: [] },
      bets: { type: 'bool', def: false },
      betMin: { type: 'int', min: 1, max: 1000000, def: 10 },
      betMax: { type: 'int', min: 1, max: 10000000, def: 1000 },
      dailyWinCap: { type: 'int', min: 0, max: 100000000, def: 5000 },
      taxPct: { type: 'int', min: 0, max: 50, def: 5 },
      coinflipPayout: { type: 'int', min: 100, max: 1000, def: 190 }, // percent of the bet paid back on a win: 190 = ×1.9
      rpsPayout: { type: 'int', min: 100, max: 1000, def: 190 }
    }
  },
  reminders: {
    column: 'reminderConfig',
    fields: {
      maxPerUser: { type: 'int', min: 1, max: 50, def: 25 },
      minMinutes: { type: 'int', min: 0, max: 1440, def: 0 },
      maxDays: { type: 'int', min: 1, max: 365, def: 365 },
      dmOnly: { type: 'bool', def: false },
      stripMentions: { type: 'bool', def: true }
    }
  },
  // «Наказания» → roles of punishments, warning points, the ladder of automatic punishments, reason presets
  mod: {
    column: 'modConfig',
    fields: {
      muteRoleId: { type: 'id', def: null },
      quarantineRoleId: { type: 'id', def: null },
      quarantineChannelId: { type: 'id', def: null }, // the one channel a member in quarantine still sees
      restrictRoles: { type: 'list', max: 10, def: [], item: { label: { type: 'str', max: 40, required: true }, roleId: { type: 'id', def: null } } },
      defaultPoints: { type: 'int', min: 1, max: 20, def: 1 },
      decayDays: { type: 'int', min: 0, max: 365, def: 0 }, // a warning burns out after so many days (0: the older general rule)
      escalateBy: { type: 'enum', values: ['count', 'points'], def: 'count' },
      ladder: {
        type: 'list', max: 10, def: [],
        item: {
          at: { type: 'int', min: 1, max: 100, def: 3 },
          action: { type: 'enum', values: ['timeout', 'role_mute', 'quarantine', 'restrict', 'temprole', 'kick', 'tempban', 'ban'], def: 'timeout' },
          minutes: { type: 'int', min: 0, max: 5256000, def: 60 }, // 0: until lifted (where that makes sense)
          roleId: { type: 'id', def: null }
        }
      },
      autoRevert: { type: 'bool', def: false }, // a removed warning also lifts the soft punishment it triggered
      silentDefault: { type: 'bool', def: false },
      presets: {
        type: 'list', max: 25, def: [],
        item: {
          label: { type: 'str', max: 60, required: true },
          reason: { type: 'str', max: 300, def: '' },
          action: { type: 'enum', values: ['warn', 'timeout', 'role_mute', 'quarantine', 'kick', 'ban'], def: 'warn' },
          minutes: { type: 'int', min: 0, max: 5256000, def: 0 },
          points: { type: 'int', min: 1, max: 20, def: 1 }
        }
      }
    }
  },
  brand: {
    column: 'brandConfig',
    fields: {
      colorInfo: { type: 'hex', def: '' },
      colorSuccess: { type: 'hex', def: '' },
      colorWarning: { type: 'hex', def: '' },
      colorError: { type: 'hex', def: '' },
      colorMod: { type: 'hex', def: '' },
      emojiSuccess: { type: 'str', max: 32, def: '✅' },
      emojiError: { type: 'str', max: 32, def: '❌' },
      footer: { type: 'str', max: 100, def: '' },
      ephemeral: { type: 'bool', def: false },
      dateStyle: { type: 'enum', values: ['', 'R', 'f', 'F', 'd', 'D', 't', 'T'], def: '' }
    }
  }
};

// «Где и для кого работает модуль»: one more column, keyed by module
const SCOPE = { allow: { type: 'ids', max: 50, def: [] }, deny: { type: 'ids', max: 50, def: [] }, exceptRoles: { type: 'ids', max: 20, def: [] }, cooldown: { type: 'int', min: 0, max: 3600, def: 0 } };
const SCOPE_MODULES = ['polls', 'fun', 'reminders', 'tickets', 'giveaways', 'music', 'leveling', 'economy', 'customCommands'];

const ERR = { int: 'Нужно целое число', range: (f) => `Значение от ${f.min} до ${f.max}`, long: (f) => `Не длиннее ${f.max} символов`, required: 'Заполните это поле',
  choice: 'Выберите один из вариантов', hex: 'Цвет в виде #rrggbb', many: (f) => `Не больше ${f.max}` };

const parse = (v) => { try { const o = typeof v === 'string' ? JSON.parse(v || '{}') : v; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const clone = (v) => (Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? { ...v } : v);
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : String(v).split(/[\s,]+/));

/** One stored value as the field wants it; invalid values become the default (reading never fails). */
function cleanValue(f, v) {
  switch (f.type) {
    case 'bool': return v === undefined ? f.def : v === true || v === 'on' || v === 'true' || v === 1 || v === '1';
    case 'int': { const n = Number(v); return Number.isInteger(n) && n >= f.min && n <= f.max ? n : f.def; }
    case 'str': return typeof v === 'string' ? v.slice(0, f.max) : f.def;
    case 'enum': return f.values.includes(v) ? v : f.def;
    case 'id': return SNOW.test(String(v || '')) ? String(v) : null;
    case 'ids': return [...new Set(asList(v).map(String).filter((x) => SNOW.test(x)))].slice(0, f.max);
    case 'hex': return HEX.test(String(v || '')) ? (String(v)[0] === '#' ? String(v) : '#' + v).toLowerCase() : '';
    case 'lines': return (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim().slice(0, f.len)).filter(Boolean).slice(0, f.max);
    case 'json': return v && typeof v === 'object' ? v : null;
    case 'list': return (Array.isArray(v) ? v : []).slice(0, f.max).map((x) => readFields(f.item, x)).filter((x) => Object.keys(f.item).every((k) => !f.item[k].required || x[k]));
    default: return f.def;
  }
}
function readFields(fields, o) {
  const src = o && typeof o === 'object' ? o : {};
  const out = {};
  for (const [k, f] of Object.entries(fields)) out[k] = k in src ? cleanValue(f, src[k]) : clone(f.def);
  return out;
}

/** The module's settings with every default filled in. */
function read(settings, key) {
  const s = SPECS[key];
  if (!s) throw new Error('Unknown module config: ' + key);
  return readFields(s.fields, parse(settings?.[s.column]));
}
const defaults = (key) => readFields(SPECS[key].fields, {});

/** A field of a form, checked: { value } or { error }. */
function formValue(f, raw) {
  switch (f.type) {
    case 'bool': return { value: raw === 'on' || raw === 'true' || raw === true || raw === '1' };
    case 'int': {
      const str = String(raw ?? '').trim(); if (str === '') return { value: f.def };
      const n = Number(str); if (!Number.isInteger(n)) return { error: ERR.int };
      if (n < f.min || n > f.max) return { error: ERR.range(f) };
      return { value: n };
    }
    case 'str': {
      const str = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim();
      if (!str && f.required) return { error: ERR.required };
      if (str.length > f.max) return { error: ERR.long(f) };
      return { value: str };
    }
    case 'enum': return f.values.includes(String(raw ?? '')) ? { value: String(raw ?? '') } : { error: ERR.choice };
    case 'id': return { value: SNOW.test(String(raw || '')) ? String(raw) : null };
    case 'ids': { const v = cleanValue(f, raw); return asList(raw).filter((x) => SNOW.test(String(x))).length > f.max ? { error: ERR.many(f) } : { value: v }; }
    case 'hex': { const str = String(raw ?? '').trim(); if (!str) return { value: '' }; return HEX.test(str) ? { value: cleanValue(f, str) } : { error: ERR.hex }; }
    case 'lines': return { value: cleanValue(f, String(raw ?? '')) };
    case 'json': return { value: undefined };
    default: return { value: f.def };
  }
}
function formFields(fields, body, prefix, errors, only) {
  const out = {};
  for (const [k, f] of Object.entries(fields)) {
    if (only && !only.includes(k)) continue;
    const name = prefix + k;
    if (f.type === 'list') {
      // the rows the form sent: the indexes that have any field of the item; an emptied row with a required field is dropped
      const idx = new Set();
      for (const key of Object.keys(body)) { const m = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)_').exec(key); if (m) idx.add(Number(m[1])); }
      const rows = [];
      for (const i of [...idx].sort((a, b) => a - b)) {
        const rowPrefix = `${name}_${i}_`;
        const req = Object.entries(f.item).filter(([, x]) => x.required).map(([x]) => x);
        if (req.length && req.every((r) => !String(body[rowPrefix + r] ?? '').trim()) && Object.keys(f.item).filter((x) => f.item[x].type === 'str').every((x) => !String(body[rowPrefix + x] ?? '').trim())) continue;
        rows.push(formFields(f.item, body, rowPrefix, errors));
      }
      if (!idx.size && !only) continue;
      if (rows.length > f.max) errors[name] = ERR.many(f);
      out[k] = rows.slice(0, f.max);
      continue;
    }
    // a field the form does not have stays as stored — unless the form names it in _fields (then an unticked box is off
    // and an empty multiple list is empty: browsers send nothing for those)
    if (!(name in body)) { if (!only || !['bool', 'ids'].includes(f.type)) continue; }
    const r = formValue(f, body[name]);
    if (r.error) errors[name] = r.error; else if (r.value !== undefined) out[k] = r.value;
  }
  return out;
}

/**
 * A module's form, checked: { values, fieldErrors }. A page with several forms names the fields of each in a hidden
 * `_fields` («a,b,c»): only those are taken, the rest stay as stored (write() merges).
 */
function fromForm(key, body = {}) {
  const errors = {};
  const only = body && body._fields ? String(body._fields).split(',').map((x) => x.trim()).filter((x) => x in SPECS[key].fields) : null;
  const values = formFields(SPECS[key].fields, body || {}, '', errors, only);
  return { values, fieldErrors: errors };
}

/** Saves the values into the settings row (only the keys given; the stored rest is kept). */
function write(settings, key, values) {
  const s = SPECS[key];
  const cur = read(settings, key);
  settings[s.column] = JSON.stringify({ ...cur, ...values });
}

// ---- «Где и для кого работает модуль» ----
function scopeOf(settings, module) {
  const all = parse(settings?.moduleScope);
  return readFields(SCOPE, all[module]);
}
function scopeFromForm(body = {}) {
  const errors = {};
  const values = formFields(SCOPE, { allow: [], deny: [], exceptRoles: [], ...body }, '', errors);
  return { values, fieldErrors: errors };
}
function writeScope(settings, module, values) {
  const all = parse(settings?.moduleScope);
  all[module] = readFields(SCOPE, values);
  settings.moduleScope = JSON.stringify(all);
}
/**
 * May this command run here? { ok } or { ok: false, why }. channel: { id, parentId } (a thread counts as its channel),
 * roles: the member's role IDs. The cooldown is checked separately (cooldownLeft).
 */
function scopeAllows(scope, { channelId, parentId, roles = [] }) {
  const here = [channelId, parentId].filter(Boolean);
  if (scope.exceptRoles.length && roles.some((r) => scope.exceptRoles.includes(r))) return { ok: false, why: 'role' };
  if (scope.deny.length && here.some((c) => scope.deny.includes(c))) return { ok: false, why: 'channel' };
  if (scope.allow.length && !here.some((c) => scope.allow.includes(c))) return { ok: false, why: 'channel', allow: scope.allow };
  return { ok: true };
}
const lastUse = new Map(); // `${guild}:${module}:${user}` → time
/** Seconds left of the module's own cooldown for this member (0 = may run now; the run is counted). */
function cooldownLeft(scope, guildId, module, userId, now = Date.now()) {
  if (!scope.cooldown) return 0;
  const k = `${guildId}:${module}:${userId}`;
  const last = lastUse.get(k) || 0;
  const left = Math.ceil((last + scope.cooldown * 1000 - now) / 1000);
  if (left > 0) return left;
  lastUse.set(k, now);
  if (lastUse.size > 20000) lastUse.delete(lastUse.keys().next().value);
  return 0;
}

module.exports = { SPECS, SCOPE, SCOPE_MODULES, read, defaults, fromForm, write, scopeOf, scopeFromForm, writeScope, scopeAllows, cooldownLeft, ERR };
