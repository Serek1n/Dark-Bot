const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');
const botEvents = require('../../../bot/modules/botEvents');
const econConfig = require('../../../bot/modules/econ/config');
const ledger = require('../../../bot/modules/econ/ledger');

// ---- "События бота": what the bot announces, where, how switching sections on is announced; start an event right here ----
const router = express.Router();
const textChannels = async (guildId) => (await getGuildChannels(guildId)).filter((c) => c.type === 0 || c.type === 5);

router.get('/:guildId/events', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels] = await Promise.all([getGuild(guildId), getSettings(guildId), textChannels(guildId)]);
  const on = econConfig.enabledKeys(settings);
  res.render('dashboard/events', {
    guild, settings, channels, cfg: botEvents.read(settings), TYPES: botEvents.TYPES, plan: botEvents.activationPlan(settings),
    econ: { on, economyOn: settings.economyEnabled !== false, treasury: on.includes('treasury') ? await ledger.treasuryOf(guildId) : 0, titles: Object.fromEntries(econConfig.FEATURES.map((f) => [f.key, f.title])) },
    active: 'events'
  });
});

router.post('/:guildId/events', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const ids = new Set((await textChannels(req.params.guildId)).map((c) => c.id));
  botEvents.applyForm(settings, req.body, (id) => ids.has(id));
  await settings.save();
  require('../../botBridge').settingsChanged?.(req.params.guildId);
  res.redirect(saved(req.params.guildId, 'events'));
});

// "Отправить пример": shows in Discord how an event looks, in the channel it would go to.
router.post('/:guildId/events/example/:type', ensureGuildAccess, async (req, res) => {
  const r = await require('../../../bot/modules/econ/events').sendExample(await getSettings(req.params.guildId), req.params.type);
  res.redirect(saved(req.params.guildId, 'events', r.ok ? 'example' : r.error === 'channel' ? 'tr_channel' : 'tr_post'));
});

module.exports = router;
