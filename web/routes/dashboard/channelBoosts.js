const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild } = require('../../discordApi');
const { snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Channel bonuses: some channels (or categories) pay more XP and coins ----
const BOOST_CHANNEL_TYPES = [0, 2, 4, 5, 13, 15]; // text, voice, category, announcement, stage, forum

router.get('/:guildId/channel-boosts', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  const channels = (await getGuildChannels(req.params.guildId)).filter((c) => BOOST_CHANNEL_TYPES.includes(c.type));
  const { parseBoosts, MAX_BOOST } = require('../../../bot/modules/leveling');
  const boosts = parseBoosts(settings.channelBoosts);
  const rows = Object.entries(boosts).map(([id, b]) => ({ id, ...b, channel: channels.find((c) => c.id === id) || null }));
  rows.sort((a, b) => (a.channel?.name || '~').localeCompare(b.channel?.name || '~', 'ru'));
  // Role multipliers (Polaris idea): same table shape, keyed by role.
  const roles = await getGuildRoles(req.params.guildId);
  const roleRows = Object.entries(parseBoosts(settings.roleBoosts)).map(([id, b]) => ({ id, ...b, role: roles.find((r) => r.id === id) || null }));
  roleRows.sort((a, b) => (b.role?.position ?? -1) - (a.role?.position ?? -1));
  const { ROLE_MODES, STACK_MODES } = require('../../../bot/modules/xpBoosts');
  res.render('dashboard/channel-boosts', { guild, settings, channels, rows, roles, roleRows, ROLE_MODES, STACK_MODES, MAX_BOOST, active: 'channel-boosts' });
});

// A multiplier from the form: "1,5" and "1.5" both work; empty = x1; limited to 0..MAX_BOOST.
function parseMultiplier(value, max) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (text === '') return 1;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(0, Math.round(n * 100) / 100));
}

router.post('/:guildId/channel-boosts', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const { parseBoosts, MAX_BOOST } = require('../../../bot/modules/leveling');
  const channelId = snowflake(req.body.channelId);
  const channels = await getGuildChannels(guildId);
  const xp = parseMultiplier(req.body.xp, MAX_BOOST);
  const coins = parseMultiplier(req.body.coins, MAX_BOOST);
  if (!channelId || !channels.some((c) => c.id === channelId && BOOST_CHANNEL_TYPES.includes(c.type)) || xp === null || coins === null) {
    return res.redirect(saved(guildId, 'channel-boosts', 'invalid'));
  }
  const settings = await getSettings(guildId);
  const boosts = parseBoosts(settings.channelBoosts);
  if (!boosts[channelId] && Object.keys(boosts).length >= 50) return res.redirect(saved(guildId, 'channel-boosts', 'invalid'));
  if (xp === 1 && coins === 1) delete boosts[channelId]; // x1 / x1 is the same as nothing
  else boosts[channelId] = { xp, coins };
  settings.channelBoosts = JSON.stringify(boosts);
  await settings.save();
  res.redirect(saved(guildId, 'channel-boosts'));
});

router.post('/:guildId/channel-boosts/delete/:channelId', ensureGuildAccess, async (req, res) => {
  const { parseBoosts } = require('../../../bot/modules/leveling');
  const settings = await getSettings(req.params.guildId);
  const boosts = parseBoosts(settings.channelBoosts);
  delete boosts[req.params.channelId];
  settings.channelBoosts = JSON.stringify(boosts);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'channel-boosts', 'deleted'));
});

// ---- Role multipliers ----
router.post('/:guildId/channel-boosts/roles', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const { parseBoosts, MAX_BOOST } = require('../../../bot/modules/leveling');
  const roleId = snowflake(req.body.roleId);
  const xp = parseMultiplier(req.body.xp, MAX_BOOST);
  const coins = parseMultiplier(req.body.coins, MAX_BOOST);
  const roles = await getGuildRoles(guildId);
  if (!roleId || roleId === guildId || !roles.some((r) => r.id === roleId) || xp === null || coins === null) return res.redirect(saved(guildId, 'channel-boosts', 'invalid'));
  const settings = await getSettings(guildId);
  const boosts = parseBoosts(settings.roleBoosts);
  if (!boosts[roleId] && Object.keys(boosts).length >= 50) return res.redirect(saved(guildId, 'channel-boosts', 'toomany'));
  if (xp === 1 && coins === 1) delete boosts[roleId];
  else boosts[roleId] = { xp, coins };
  settings.roleBoosts = JSON.stringify(boosts);
  await settings.save();
  res.redirect(saved(guildId, 'channel-boosts'));
});

router.post('/:guildId/channel-boosts/roles/delete/:roleId', ensureGuildAccess, async (req, res) => {
  const { parseBoosts } = require('../../../bot/modules/leveling');
  const settings = await getSettings(req.params.guildId);
  const boosts = parseBoosts(settings.roleBoosts);
  delete boosts[req.params.roleId];
  settings.roleBoosts = JSON.stringify(boosts);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'channel-boosts', 'deleted'));
});

router.post('/:guildId/channel-boosts/modes', ensureGuildAccess, async (req, res) => {
  const { ROLE_MODES, STACK_MODES } = require('../../../bot/modules/xpBoosts');
  const settings = await getSettings(req.params.guildId);
  if (ROLE_MODES.includes(req.body.roleBoostMode)) settings.roleBoostMode = req.body.roleBoostMode;
  if (STACK_MODES.includes(req.body.boostStacking)) settings.boostStacking = req.body.boostStacking;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'channel-boosts'));
});

module.exports = router;
