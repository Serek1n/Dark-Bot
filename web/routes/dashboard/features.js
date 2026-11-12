const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Features: switch parts of the bot on and off ----
const { FEATURES } = require('../../../bot/utils/features');

router.get('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  res.render('dashboard/features', { guild, settings, features: FEATURES, active: 'features' });
});

router.post('/:guildId/language', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const lang = ['ru', 'en', 'auto'].includes(req.body.language) ? req.body.language : 'auto';
  if (lang !== settings.language) {
    const effective = lang === 'auto' ? null : lang;
    if (effective) require('../../../i18n/settings').switchDefaults(settings, effective);
    settings.language = lang;
    await settings.save();
  }
  res.redirect(saved(req.params.guildId, 'features'));
});

router.post('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  FEATURES.forEach((f) => { settings[f.field] = req.body[f.field] === 'on'; });
  await settings.save();
  res.redirect(saved(req.params.guildId, 'features'));
});

// One module on or off, from a switch (the top menu, a module's header, the home page, the modules page). Answers JSON
// for the switch; a form without scripts gets the page back. "also" switches off the modules that depend on this one
// (Магазин without Экономика) when the person ticked them in the dialog.
router.post('/:guildId/modules/:key', ensureGuildAccess, async (req, res) => {
  const { BY_KEY, dependentsOf } = require('../../modules');
  const m = BY_KEY.get(req.params.key);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (!m || !m.field) return wantsJson ? res.status(404).json({ ok: false }) : res.redirect(`/dashboard/${req.params.guildId}/features`);
  const on = req.body.on === '1' || req.body.on === 'true' || req.body.on === 'on';
  const settings = await getSettings(req.params.guildId);
  const changed = [m.key];
  settings[m.field] = on;
  if (!on) {
    const allowed = new Set(dependentsOf(m.key));
    for (const k of [].concat(req.body.also || [])) {
      const d = BY_KEY.get(String(k));
      if (d && d.field && allowed.has(d.key)) { settings[d.field] = false; changed.push(d.key); }
    }
  }
  await settings.save();
  if (wantsJson) return res.json({ ok: true, on, changed });
  const back = String(req.body.back || '');
  res.redirect(back.startsWith(`/dashboard/${req.params.guildId}`) ? back : saved(req.params.guildId, 'features'));
});

// "Доска почёта" was removed: an old bookmark opens the overview instead of an error.
router.get('/:guildId/starboard', (req, res) => {
  const id = require('../../utils/common').snowflake(req.params.guildId);
  res.redirect(301, id ? `/dashboard/${id}` : '/dashboard');
});

module.exports = router;
