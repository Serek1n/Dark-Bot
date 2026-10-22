const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild } = require('../../discordApi');
const { CustomCommand } = require('../../../db');
const { saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Custom commands ----
router.get('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const commands = await CustomCommand.findAll({ where: { guildId: req.params.guildId } });
  const settings = await getSettings(req.params.guildId);
  res.render('dashboard/custom-commands', { guild, commands, settings, active: 'custom-commands' });
});

router.post('/:guildId/custom-commands/prefix', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const prefix = (req.body.prefix || '').trim().slice(0, 3);
  if (!prefix || /\s/.test(prefix)) return res.redirect(saved(req.params.guildId, 'custom-commands', 'invalid'));
  settings.prefix = prefix;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'custom-commands'));
});

router.post('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  // Triggers are a single word; strip the prefix if the admin typed it ("!rules" -> "rules").
  let trigger = (req.body.trigger || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (settings.prefix && trigger.startsWith(settings.prefix.toLowerCase())) trigger = trigger.slice(settings.prefix.length);
  trigger = trigger.slice(0, 32);
  const response = (req.body.response || '').trim().slice(0, 2000);
  if (!trigger || !response) return res.redirect(saved(req.params.guildId, 'custom-commands', 'invalid'));
  await CustomCommand.upsert({ guildId: req.params.guildId, trigger, response, createdBy: req.user.id });
  res.redirect(saved(req.params.guildId, 'custom-commands'));
});

router.post('/:guildId/custom-commands/delete/:id', ensureGuildAccess, async (req, res) => {
  await CustomCommand.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'custom-commands', 'deleted'));
});

module.exports = router;
