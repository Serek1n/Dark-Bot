const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getUsers } = require('../../discordApi');
const { Giveaway, GiveawayEntry } = require('../../../db');
const { clampInt, saved, getSettings } = require('../../utils/common');
const { getClient } = require('../../botBridge');

const router = express.Router();

// ---- Giveaways: what is running and what ended, ended early or redrawn from the panel ----
router.get('/:guildId/giveaways', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels, list] = await Promise.all([
    getGuild(guildId), getSettings(guildId), getGuildChannels(guildId),
    Giveaway.findAll({ where: { guildId }, order: [['ended', 'ASC'], ['endsAt', 'DESC']], limit: 30 })
  ]);
  const counts = new Map();
  if (list.length) {
    const rows = await GiveawayEntry.findAll({ where: { giveawayId: list.map((g) => g.id) }, attributes: ['giveawayId', [GiveawayEntry.sequelize.fn('COUNT', '*'), 'n']], group: ['giveawayId'], raw: true });
    rows.forEach((r) => counts.set(r.giveawayId, Number(r.n)));
  }
  const { parseWinners, rewardText } = require('../../../bot/modules/giveaways');
  const winners = new Map(list.map((g) => [g.id, parseWinners(g)]));
  const users = await getUsers([...new Set([...list.map((g) => g.hostId), ...[...winners.values()].flat()])]);
  res.render('dashboard/giveaways', {
    guild, settings, channels, users, active: 'giveaways', botOnline: Boolean(getClient()),
    giveaways: list.map((g) => ({ g, entries: counts.get(g.id) || 0, winners: winners.get(g.id), reward: rewardText(g, settings) }))
  });
});

async function act(req, res, kind) {
  const { guildId } = req.params;
  const g = await Giveaway.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!g || (kind === 'end' && g.ended) || (kind === 'reroll' && !g.ended)) return res.redirect(saved(guildId, 'giveaways', 'invalid'));
  const client = getClient(); // ending posts in Discord and pays the prize: only the bot can do it
  if (!client) return res.redirect(saved(guildId, 'giveaways', 'nobot'));
  await require('../../../bot/modules/giveaways').finishGiveaway(client, g, { reroll: kind === 'reroll' });
  res.redirect(saved(guildId, 'giveaways', kind === 'end' ? 'gwended' : 'gwreroll'));
}
router.post('/:guildId/giveaways/:id/end', ensureGuildAccess, (req, res) => act(req, res, 'end'));
router.post('/:guildId/giveaways/:id/reroll', ensureGuildAccess, (req, res) => act(req, res, 'reroll'));

module.exports = router;
