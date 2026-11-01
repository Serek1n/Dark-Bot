// Keeps the translator's map of server languages in step with the database, and switches the texts the bot wrote for a
// server by default (welcome, farewell, currency names…) when the server's language changes.
const i18n = require('./index');

// Fields whose default text depends on the language. Only a value still equal to the default of the other language is changed:
// whatever the admins wrote themselves stays as it is.
const DEFAULT_FIELDS = ['welcomeMessage', 'leaveMessage', 'currencyName', 'crystalName', 'ticketMessage', 'automodNickReplacement', 'tempVoiceNameTemplate'];

function attach(models) {
  const { GuildSettings } = models;
  if (!GuildSettings || GuildSettings.__i18n) return;
  GuildSettings.__i18n = true;
  const remember = (row) => { if (row?.guildId) i18n.setGuildLang(row.guildId, row.language); };
  GuildSettings.addHook('afterCreate', remember);
  GuildSettings.addHook('afterSave', remember);
  GuildSettings.addHook('afterUpdate', remember);
  GuildSettings.addHook('afterBulkUpdate', () => load(GuildSettings).catch(() => {}));
}

async function load(GuildSettings) {
  const rows = await GuildSettings.findAll({ attributes: ['guildId', 'language'], raw: true });
  for (const r of rows) i18n.setGuildLang(r.guildId, r.language);
  return rows.length;
}

/** The server's default texts in `lang` (call before saving a language change). Returns the names of the changed fields. */
function switchDefaults(settings, lang) {
  const changed = [];
  for (const f of DEFAULT_FIELDS) {
    const v = settings[f]; const def = settings.constructor?.rawAttributes?.[f]?.defaultValue;
    if (typeof v !== 'string' || typeof def !== 'string') continue;
    const en = i18n.exact.get(def); if (!en) continue;
    if (lang === 'en' && v === def) { settings[f] = en; changed.push(f); }
    if (lang === 'ru' && v === en) { settings[f] = def; changed.push(f); }
  }
  return changed;
}

module.exports = { attach, load, switchDefaults, DEFAULT_FIELDS };
