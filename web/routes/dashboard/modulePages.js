const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getGuildRoles, getUsers } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');
const mc = require('../../../bot/utils/moduleConfig');

// ---- The pages of the modules that were commands only: «Голосования», «Мини-игры», «Напоминания» ----
const router = express.Router();
const PAGES = { polls: 'polls', fun: 'fun', reminders: 'reminders' };

async function base(req, key) {
  const { guildId } = req.params;
  const [guild, settings, channels, roles] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId), getGuildRoles(guildId)]);
  return { guild, settings, channels, roles: roles.filter((r) => r.name !== '@everyone'), active: PAGES[key], cfg: mc.read(settings, key), scopeCfg: mc.scopeOf(settings, key) };
}

router.get('/:guildId/polls', ensureGuildAccess, async (req, res) => {
  const { Poll } = require('../../../db');
  const data = await base(req, 'polls');
  const status = req.query.status === 'ended' ? 'ended' : 'live';
  const rows = await Poll.findAll({ where: { guildId: req.params.guildId, ended: status === 'ended', action: null }, order: [['id', 'DESC']], limit: 50 });
  const users = await getUsers([...new Set(rows.map((p) => p.authorId).filter(Boolean))]);
  const live = await Poll.count({ where: { guildId: req.params.guildId, ended: false } });
  res.render('dashboard/polls', { ...data, rows, users, status, live, NEVER: require('../../../bot/modules/polls').NEVER.getTime() });
});
router.post('/:guildId/polls/:id(\\d+)/end', ensureGuildAccess, async (req, res) => {
  const ok = await require('../../../bot/modules/polls').endNow(req.params.guildId, Number(req.params.id));
  res.redirect(saved(req.params.guildId, 'polls', ok ? 'pollended' : 'invalid'));
});

router.get('/:guildId/fun', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'fun');
  res.render('dashboard/fun', { ...data, ANSWERS: require('../../../bot/commands/fun/fun').ANSWERS, economyOn: require('../../../bot/utils/features').isEnabled(data.settings, 'economy') });
});

router.get('/:guildId/reminders', ensureGuildAccess, async (req, res) => {
  const { Reminder } = require('../../../db');
  const data = await base(req, 'reminders');
  const q = String(req.query.q || '').trim();
  const where = { guildId: req.params.guildId, remindAt: { [Op.gt]: new Date(0) } };
  if (/^\d{15,25}$/.test(q)) where.userId = q;
  else if (q) where.text = { [Op.like]: `%${q.replace(/[%_]/g, '')}%` };
  const [rows, total] = await Promise.all([Reminder.findAll({ where, order: [['remindAt', 'ASC']], limit: 100 }), Reminder.count({ where: { guildId: req.params.guildId } })]);
  const users = await getUsers([...new Set(rows.map((r) => r.userId))]);
  res.render('dashboard/reminders', { ...data, rows, users, q, total });
});
router.post('/:guildId/reminders/:id(\\d+)/delete', ensureGuildAccess, async (req, res) => {
  const { Reminder } = require('../../../db');
  const n = await Reminder.destroy({ where: { id: Number(req.params.id), guildId: req.params.guildId } });
  if (n) require('../../../bot/utils/scheduler').poke('reminders');
  res.redirect(saved(req.params.guildId, 'reminders', n ? 'reminderdeleted' : 'invalid'));
});

// One way to save the settings of these modules (and of the tickets' and the branding's own forms that post here):
// the fields the form names in _fields, checked by bot/utils/moduleConfig.js.
router.post('/:guildId/config/:key', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const key = String(req.params.key);
  if (!['polls', 'fun', 'reminders', 'brand'].includes(key)) return res.status(404).json({ ok: false });
  const page = key === 'brand' ? 'settings' : PAGES[key];
  const { values, fieldErrors } = mc.fromForm(key, req.body);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (Object.keys(fieldErrors).length) return wantsJson ? res.status(400).json({ ok: false, fieldErrors }) : res.redirect(`/dashboard/${guildId}/${page}?invalid=1&err=${Object.keys(fieldErrors).join(',')}`);
  const settings = await getSettings(guildId);
  if (key === 'fun' && values.betMin !== undefined && values.betMax !== undefined && values.betMax < values.betMin) [values.betMin, values.betMax] = [values.betMax, values.betMin];
  mc.write(settings, key, values);
  await settings.save();
  if (key === 'brand') require('../../../bot/modules/branding').forget(guildId);
  if (wantsJson) return res.json({ ok: true });
  res.redirect(saved(guildId, page));
});

module.exports = router;
