const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Features: switch parts of the bot on and off ----
const { FEATURES } = require('../../../bot/utils/features');
const { isBetaBuild } = require('../../../bot/utils/channel');

// Beta features exist only in the beta build: the release does not list them and never changes their saved switches.
const listed = () => FEATURES.filter((f) => !f.beta || isBetaBuild());

router.get('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  res.render('dashboard/features', { guild, settings, features: listed(), betaBuild: isBetaBuild(), active: 'features' });
});

router.post('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  listed().forEach((f) => { settings[f.field] = req.body[f.field] === 'on'; });
  if (isBetaBuild()) settings.betaEnabled = req.body.betaEnabled === 'on';
  await settings.save();
  res.redirect(saved(req.params.guildId, 'features'));
});

module.exports = router;
