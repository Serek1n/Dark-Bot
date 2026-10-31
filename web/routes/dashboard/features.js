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

router.post('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  FEATURES.forEach((f) => { settings[f.field] = req.body[f.field] === 'on'; });
  await settings.save();
  res.redirect(saved(req.params.guildId, 'features'));
});

module.exports = router;
