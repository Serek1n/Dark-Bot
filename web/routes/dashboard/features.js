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

// "Доска почёта" was removed: an old bookmark opens the overview instead of an error.
router.get('/:guildId/starboard', (req, res) => {
  const id = require('../../utils/common').snowflake(req.params.guildId);
  res.redirect(301, id ? `/dashboard/${id}` : '/dashboard');
});

module.exports = router;
