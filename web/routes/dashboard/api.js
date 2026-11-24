// Saving settings without reloading the page. A form marked data-api="<section>" sends only its own fields as JSON:
//   PATCH /dashboard/:guildId/api/settings/:section   { values: { field: value, … } }
//   → 200 { ok, values, warnings }  — saved; warnings: what the bot will lack in a chosen channel (saved anyway: the old
//                                     value is kept for that field, as the classic forms do)
//   → 400 { ok: false, fieldErrors: { field: 'text' } } — nothing is saved, the texts go under the fields
//   POST  /dashboard/:guildId/api/settings/:section/reset → the section's defaults (shared/settingsSchema.js)
// Everything the classic forms go through applies here too: signed in, rights on the server (ensureGuildAccess), the
// site's own origin (csrfGuard), the rate limit for changes and the audit line (web/index.js).
const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles } = require('../../discordApi');
const { getSettings } = require('../../utils/common');
const { settingsChanged } = require('../../botBridge');
const schema = require('../../../shared/settingsSchema');

const router = express.Router();
const json = express.json({ limit: '50kb' });

async function context(guildId, sec) {
  const types = new Set(Object.values(sec.fields).map((f) => f.type));
  const [channels, roles] = await Promise.all([
    types.has('channel') ? getGuildChannels(guildId) : null,
    types.has('role') ? getGuildRoles(guildId) : null
  ]);
  return { channels, roles };
}

router.patch('/:guildId/api/settings/:section', json, ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const sec = schema.section(req.params.section);
  if (!sec) return res.status(404).json({ ok: false, error: 'Неизвестный раздел настроек' });
  const input = req.body && typeof req.body.values === 'object' && req.body.values ? req.body.values : {};
  const ctx = await context(guildId, sec);
  const { values, fieldErrors } = schema.validate(req.params.section, input, ctx);

  // A role must be one this person may hand out and the bot can give (an unchanged one stays as it is).
  const settings = await getSettings(guildId);
  const roleFields = Object.entries(sec.fields).filter(([k, f]) => f.type === 'role' && values[k] && values[k] !== settings[k]);
  if (roleFields.length) {
    const guard = await require('../../utils/roles').roleGuard(guildId, req.user?.id);
    for (const [k] of roleFields) { const why = guard.check(values[k]); if (why) fieldErrors[k] = 'Эту роль выдавать нельзя: ' + why; }
  }
  if (Object.keys(fieldErrors).length) {
    if (req.lang === 'en') { const { toEnglish } = require('../../../i18n'); for (const k of Object.keys(fieldErrors)) fieldErrors[k] = toEnglish(fieldErrors[k], true); }
    return res.status(400).json({ ok: false, fieldErrors });
  }

  // A channel the bot cannot work in: the field keeps its old value, the page says what is missing.
  const warnings = {};
  const chanFields = Object.entries(sec.fields).filter(([k, f]) => f.type === 'channel' && values[k] && values[k] !== settings[k]);
  if (chanFields.length) {
    const guard = await require('../../utils/channels').channelGuard(guildId);
    for (const [k, f] of chanFields) { const miss = guard.missing(values[k], f.need || 'post'); if (miss) { warnings[k] = miss; delete values[k]; } }
  }

  const final = sec.normalize ? sec.normalize({ ...values }, settings) : values;
  Object.assign(settings, final);
  await settings.save();
  settingsChanged(guildId, sec.module);
  res.json({ ok: true, values: final, warnings });
});

router.post('/:guildId/api/settings/:section/reset', ensureGuildAccess, async (req, res) => {
  const sec = schema.section(req.params.section);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (!sec) return wantsJson ? res.status(404).json({ ok: false }) : res.redirect(`/dashboard/${req.params.guildId}`);
  const settings = await getSettings(req.params.guildId);
  const values = schema.defaults(req.params.section, settings.constructor.rawAttributes);
  Object.assign(settings, values);
  await settings.save();
  settingsChanged(req.params.guildId, sec.module);
  if (wantsJson) return res.json({ ok: true, values });
  const back = String(req.body?.back || '');
  res.redirect(back.startsWith(`/dashboard/${req.params.guildId}`) ? back + (back.includes('?') ? '&' : '?') + 'reset=1' : `/dashboard/${req.params.guildId}`);
});

// Body-parser problems (too large, not JSON) answer in JSON, so the page can show them.
router.use('/:guildId/api', (err, req, res, next) => {
  if (!err) return next();
  res.status(err.status && err.status < 500 ? err.status : 400).json({ ok: false, error: 'Не удалось прочитать данные формы' });
});

module.exports = router;
