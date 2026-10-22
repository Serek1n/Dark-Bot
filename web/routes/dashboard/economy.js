const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getUsers } = require('../../discordApi');
const { MemberProfile, sequelize } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Economy: currencies ----
router.get('/:guildId/economy', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  const where = { guildId: req.params.guildId };
  const [coinsTotal, crystalsTotal, holders] = await Promise.all([
    MemberProfile.sum('balance', { where }),
    MemberProfile.sum('crystals', { where }),
    MemberProfile.count({ where: { guildId: req.params.guildId, balance: { [Op.gt]: 0 } } })
  ]);
  const richest = await MemberProfile.findAll({ where, order: [['balance', 'DESC']], limit: 5 });
  const users = await getUsers(richest.map((p) => p.userId));
  res.render('dashboard/economy', { guild, settings, stats: { coinsTotal: coinsTotal || 0, crystalsTotal: crystalsTotal || 0, holders }, richest, users, active: 'economy' });
});

// Manual correction of a member's wallet (add or take away); never goes below zero.
router.post('/:guildId/economy/grant', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'economy', 'baduser'));
  const field = req.body.currency === 'crystals' ? 'crystals' : 'balance';
  const amount = clampInt(req.body.amount, -1000000000, 1000000000, 0);
  await MemberProfile.findOrCreate({ where: { guildId, userId } });
  // One SQL statement: the bot may pay out coins in the same second, and a read-then-write here would lose one of the two changes.
  await MemberProfile.update({ [field]: sequelize.literal(`MAX(0, COALESCE(${field}, 0) + ${amount})`) }, { where: { guildId, userId } });
  res.redirect(saved(guildId, 'economy', 'granted'));
});

router.post('/:guildId/economy', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const name = (v, fallback) => String(v || '').trim().slice(0, 24) || fallback;
  settings.currencyName = name(req.body.currencyName, settings.currencyName);
  settings.crystalName = name(req.body.crystalName, settings.crystalName);
  settings.dailyCoins = clampInt(req.body.dailyCoins, 0, 1000000, settings.dailyCoins);
  settings.dailyStreakBonus = clampInt(req.body.dailyStreakBonus, 0, 1000000, settings.dailyStreakBonus);
  settings.dailyStreakMax = clampInt(req.body.dailyStreakMax, 1, 365, settings.dailyStreakMax);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'economy'));
});

module.exports = router;
