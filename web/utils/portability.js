// «Базовые настройки» → «Перенос настроек»: the server's settings as a JSON file, loaded on another server with its
// channels and roles matched by name (an ID that this server has stays; a name found here takes its ID; the rest is
// left out and named in the result), and a module reset to its defaults.
const SNOW = /^\d{15,25}$/;
// never carried over: who the server is, its money and seasons, secrets, the IDs of messages posted on that server
const SKIP = /^(guildId|createdAt|updatedAt|treasury|seasonNumber|seasonStartedAt|logWebhookId|logWebhookToken)$|Token$|Secret$|MessageId$/;
const JSON_COLUMNS = ['ticketConfig', 'pollConfig', 'funConfig', 'reminderConfig', 'brandConfig', 'moduleScope', 'appearance', 'botEvents'];

/** The file: { format, exportedAt, guild, settings, names: { channels, roles } }. */
function exportSettings(settings, { guild, channels = [], roles = [] }) {
  const out = {};
  const values = settings.dataValues || settings;
  for (const [k, v] of Object.entries(values)) if (!SKIP.test(k)) out[k] = v;
  for (const c of JSON_COLUMNS) if (typeof out[c] === 'string') { try { out[c] = JSON.parse(out[c]); } catch { /* left as text */ } }
  // IDs of messages inside the configs belong to the old server
  if (out.ticketConfig && typeof out.ticketConfig === 'object') { out.ticketConfig = { ...out.ticketConfig }; delete out.ticketConfig.panelMessageId; }
  return {
    format: 'dark-settings/1', exportedAt: new Date().toISOString(), guild: guild ? { id: guild.id, name: guild.name } : null, settings: out,
    names: { channels: Object.fromEntries(channels.map((c) => [c.id, { n: c.name, t: c.type }])), roles: Object.fromEntries(roles.map((r) => [r.id, r.name])) }
  };
}

/**
 * The values of a file for this server: { values, report: { kept, mapped, dropped: [{ field, id, name }] } }.
 * attributes: the model's columns (unknown keys of the file are left out); channels, roles: this server's.
 */
function importSettings(file, { attributes, channels = [], roles = [] }) {
  if (!file || typeof file !== 'object' || file.format !== 'dark-settings/1' || !file.settings || typeof file.settings !== 'object') throw Object.assign(new Error('Это не файл настроек Dark.'), { user: true });
  const names = file.names || { channels: {}, roles: {} };
  const here = { ch: new Set(channels.map((c) => c.id)), ro: new Set(roles.map((r) => r.id)) };
  const report = { kept: 0, mapped: 0, dropped: [] };
  const byName = (id) => {
    const c = names.channels?.[id];
    if (c) { const m = channels.find((x) => x.name === c.n && (c.t === undefined || x.type === c.t)); return m ? m.id : null; }
    const r = names.roles?.[id];
    if (r) { const m = roles.find((x) => x.name === r); return m ? m.id : null; }
    return null;
  };
  const fix = (id, field) => {
    if (here.ch.has(id) || here.ro.has(id)) { report.kept++; return id; }
    const m = byName(id);
    if (m) { report.mapped++; return m; }
    // an ID that is not a channel or a role of the old server (a member on a blacklist): kept as it is
    if (!names.channels?.[id] && !names.roles?.[id]) return id;
    report.dropped.push({ field, id, name: names.channels?.[id]?.n || names.roles?.[id] || '' });
    return null;
  };
  const walk = (v, field) => {
    if (typeof v === 'string' && SNOW.test(v)) return fix(v, field);
    if (Array.isArray(v)) return v.map((x) => walk(x, field)).filter((x) => x !== null);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${field}.${k}`)]));
    return v;
  };
  const values = {};
  for (const [k, v] of Object.entries(file.settings)) {
    if (SKIP.test(k) || !attributes[k]) continue;
    let x = walk(v, k);
    if (JSON_COLUMNS.includes(k) && x && typeof x === 'object') x = JSON.stringify(x);
    values[k] = x;
  }
  return { values, report };
}

// a module's own settings, for «Сбросить модуль»: its columns by name (its on/off switch is not touched)
const MODULE_COLUMNS = {
  tickets: /^ticket/, polls: /^pollConfig$/, fun: /^funConfig$/, reminders: /^reminderConfig$/, brand: /^brandConfig$/,
  welcome: /^(welcome(?!Enabled)|leave|autoRole|restore)/, leveling: /^(xp|chat(?!.*Enabled)|voice(?!Roles)|levelUp|leaderboard|crystalsPerLevel|levelRoles)/,
  moderation: /^mod(?!erationEnabled)/, tempVoice: /^tempVoice(?!Enabled)/, appearance: /^appearance$/, events: /^botEvents$/
};
const MODULE_TITLES = { tickets: 'Тикеты', polls: 'Голосования', fun: 'Мини-игры', reminders: 'Напоминания', brand: 'Ответы бота', welcome: 'Приветствие и автороль', leveling: 'Уровни', moderation: 'Наказания', tempVoice: 'Временные голосовые', appearance: 'Оформление', events: 'События бота' };

/** Puts a module's columns back to the model's defaults (and forgets where it works). Returns the columns reset. */
function resetModule(settings, module, attributes) {
  const re = MODULE_COLUMNS[module];
  if (!re) return [];
  const done = [];
  for (const [k, a] of Object.entries(attributes)) {
    if (!re.test(k) || /Enabled$/.test(k)) continue;
    settings[k] = a.defaultValue !== undefined ? (typeof a.defaultValue === 'function' ? null : a.defaultValue) : null;
    done.push(k);
  }
  try { const all = JSON.parse(settings.moduleScope || '{}'); if (all[module]) { delete all[module]; settings.moduleScope = JSON.stringify(all); } } catch { /* nothing kept */ }
  return done;
}

module.exports = { exportSettings, importSettings, resetModule, MODULE_COLUMNS, MODULE_TITLES, SKIP };
