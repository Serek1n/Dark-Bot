// One description of the panel's settings, used in three places: the server checks what a form sends (PATCH
// /dashboard/:guildId/api/settings/:section), the templates put the same limits on the inputs (min, max, maxlength,
// required), and «Сбросить к стандартным» takes the defaults from here. A section is what one form on a page saves.
//
// Field types: boolean · integer (min, max) · string (maxLength, trim) · enum (values) · channel (channelTypes, need: what
// the bot must be allowed to do there, see web/utils/channels.js) · role (checked against the bot's highest role).
// nullable: an empty value is stored as null instead of being refused. default: when the model has none of its own.

const SECTIONS = {
  // «Уровни» → «Начисление»
  'leveling.accrual': {
    module: 'leveling',
    fields: {
      chatEnabled: { type: 'boolean' },
      xpPerMessageMin: { type: 'integer', min: 1, max: 1000 },
      xpPerMessageMax: { type: 'integer', min: 1, max: 1000 },
      xpCooldownSeconds: { type: 'integer', min: 0, max: 3600 },
      chatCoinsPerMessage: { type: 'integer', min: 0, max: 10000 },
      voiceEnabled: { type: 'boolean' },
      voiceXpPerMinute: { type: 'integer', min: 0, max: 500 },
      voiceCoinsPerMinute: { type: 'integer', min: 0, max: 10000 },
      voiceMinMembers: { type: 'integer', min: 1, max: 10 },
      voiceSkipMuted: { type: 'boolean' }
    },
    // «от» and «до» may be typed the wrong way round: they are put in order instead of being refused
    normalize(v, cur) {
      const min = v.xpPerMessageMin ?? cur.xpPerMessageMin; const max = v.xpPerMessageMax ?? cur.xpPerMessageMax;
      if ('xpPerMessageMin' in v || 'xpPerMessageMax' in v) { v.xpPerMessageMin = Math.min(min, max); v.xpPerMessageMax = Math.max(min, max); }
      return v;
    }
  },
  // «Уровни» → «Награды и роли»
  'leveling.rewards': {
    module: 'leveling',
    fields: {
      crystalsPerLevel: { type: 'integer', min: 0, max: 10000 },
      levelRolesReplace: { type: 'boolean' }
    }
  },
  // «Уровни» → «Уведомления и топ»: the plain fields (the text with its embed is saved by the page's own form)
  'leveling.notify': {
    module: 'leveling',
    fields: {
      levelUpDestination: { type: 'enum', values: ['auto', 'dm', 'off'], default: 'auto' },
      levelUpChannelId: { type: 'channel', channelTypes: [0, 5], need: 'post', nullable: true },
      levelUpInVoice: { type: 'boolean' },
      levelUpRewardOnly: { type: 'boolean' },
      levelUpEvery: { type: 'integer', min: 1, max: 100, default: 1 },
      levelUpEveryUntil: { type: 'integer', min: 0, max: 1000, default: 0 }
    }
  },
  'leveling.public': {
    module: 'leveling',
    fields: {
      leaderboardPublic: { type: 'boolean' },
      leaderboardMinLevel: { type: 'integer', min: 0, max: 1000, default: 0 }
    }
  },
  // «Приветствие» → «Автороль и возврат»
  'welcome.rejoin': {
    module: 'welcome',
    fields: {
      autoRoleId: { type: 'role', nullable: true },
      restoreOnRejoin: { type: 'boolean' },
      restoreDays: { type: 'integer', min: 1, max: 365 },
      restoreStaffRoles: { type: 'boolean' }
    }
  }
};

const ERR = {
  integer: 'Нужно целое число',
  range: (f) => `Значение от ${f.min} до ${f.max}`,
  min: (f) => `Не меньше ${f.min}`,
  max: (f) => `Не больше ${f.max}`,
  long: (f) => `Не длиннее ${f.maxLength} символов`,
  required: 'Заполните это поле',
  choice: 'Выберите один из вариантов',
  channel: 'Выберите канал этого сервера',
  channelType: 'Этот канал не подходит: выберите текстовый канал',
  role: 'Выберите роль этого сервера'
};

const section = (key) => SECTIONS[key] || null;
const sectionsOf = (module) => Object.keys(SECTIONS).filter((k) => SECTIONS[k].module === module);

/**
 * Checks the values a form sent for one section. Only the fields that came are looked at (a form may hold a part of a
 * section). Returns { values, fieldErrors }: values are converted (booleans, numbers, null), errors are texts by field.
 * ctx: { channels: [{ id, type }], roles: [{ id }] } — what exists on the server, for channel and role fields.
 */
function validate(key, input, ctx = {}) {
  const s = section(key);
  if (!s) return { values: {}, fieldErrors: { _section: 'Неизвестный раздел настроек' } };
  const values = {}; const fieldErrors = {};
  for (const [name, f] of Object.entries(s.fields)) {
    if (!(name in (input || {}))) continue;
    const raw = input[name];
    const err = (text) => { fieldErrors[name] = text; };
    switch (f.type) {
      case 'boolean': values[name] = raw === true || raw === 'on' || raw === 'true' || raw === 1 || raw === '1'; break;
      case 'integer': {
        const str = String(raw ?? '').trim();
        if (str === '') { if (f.nullable) values[name] = null; else err(ERR.required); break; }
        const n = Number(str);
        if (!Number.isInteger(n)) { err(ERR.integer); break; }
        if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) { err(f.min !== undefined && f.max !== undefined ? ERR.range(f) : f.min !== undefined ? ERR.min(f) : ERR.max(f)); break; }
        values[name] = n; break;
      }
      case 'string': {
        const str = String(raw ?? '').trim();
        if (!str) { if (f.nullable) values[name] = null; else if (f.required) err(ERR.required); else values[name] = ''; break; }
        if (f.maxLength && str.length > f.maxLength) { err(ERR.long(f)); break; }
        values[name] = str; break;
      }
      case 'enum': if (f.values.includes(String(raw))) values[name] = String(raw); else err(ERR.choice); break;
      case 'channel': {
        const id = String(raw ?? '').trim();
        if (!id) { if (f.nullable) values[name] = null; else err(ERR.required); break; }
        const ch = (ctx.channels || []).find((c) => c.id === id);
        if (!/^\d{15,25}$/.test(id) || (ctx.channels && !ch)) { err(ERR.channel); break; }
        if (ch && f.channelTypes && !f.channelTypes.includes(ch.type)) { err(ERR.channelType); break; }
        values[name] = id; break;
      }
      case 'role': {
        const id = String(raw ?? '').trim();
        if (!id) { if (f.nullable) values[name] = null; else err(ERR.required); break; }
        if (!/^\d{15,25}$/.test(id) || (ctx.roles && !ctx.roles.some((r) => r.id === id))) { err(ERR.role); break; }
        values[name] = id; break;
      }
      default: break;
    }
  }
  return { values, fieldErrors };
}

/** The defaults of a section: the schema's own, else the database model's. */
function defaults(key, modelAttributes = {}) {
  const s = section(key);
  if (!s) return {};
  const out = {};
  for (const [name, f] of Object.entries(s.fields)) {
    if (f.default !== undefined) out[name] = f.default;
    else if (modelAttributes[name] && modelAttributes[name].defaultValue !== undefined) out[name] = modelAttributes[name].defaultValue;
    else out[name] = f.type === 'boolean' ? false : null;
  }
  return out;
}

/** HTML attributes for an input of this field: the same limits the server checks (min, max, maxlength, required). */
function attrs(key, name) {
  const f = section(key)?.fields[name];
  if (!f) return '';
  const a = [];
  if (f.type === 'integer') { a.push('step="1"'); if (f.min !== undefined) a.push(`min="${f.min}"`); if (f.max !== undefined) a.push(`max="${f.max}"`); if (!f.nullable) a.push('required'); }
  if (f.type === 'string' && f.maxLength) a.push(`maxlength="${f.maxLength}"`);
  return a.join(' ');
}

module.exports = { SECTIONS, section, sectionsOf, validate, defaults, attrs, ERR };
