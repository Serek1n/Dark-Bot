const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getGuildRoles, getUsers } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');
const { getClient } = require('../../botBridge');
const mc = require('../../../bot/utils/moduleConfig');

const router = express.Router();
const tickets = () => require('../../../bot/modules/tickets');
const SNOW = /^\d{15,25}$/;

// ---- «Жалобы и тикеты» → «Тикеты»: who handles them, the topics with their questions, the panel message, closing ----
router.get('/:guildId/tickets', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels, roles] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId), getGuildRoles(guildId)]);
  res.render('dashboard/tickets', {
    guild, settings, channels, roles: roles.filter((r) => r.name !== '@everyone'), active: 'tickets', cfg: mc.read(settings, 'tickets'),
    scopeCfg: mc.scopeOf(settings, 'tickets'), botOnline: Boolean(getClient()), errors: req.query.err ? String(req.query.err).split(',') : []
  });
});

// The settings of the page: each form names its fields in _fields; the older columns come with them when present.
router.post('/:guildId/tickets/settings', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const { values, fieldErrors } = mc.fromForm('tickets', req.body);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (Object.keys(fieldErrors).length) return wantsJson ? res.status(400).json({ ok: false, fieldErrors }) : res.redirect(`/dashboard/${guildId}/tickets?invalid=1&err=${Object.keys(fieldErrors).join(',')}`);
  if ('panelEmbed_on' in req.body || req.body._embed === '1') values.panelEmbed = JSON.parse(require('../../utils/embedForm').embedFromBody(req.body, 'panelEmbed') || 'null');
  mc.write(settings, 'tickets', values);
  if ('ticketCategoryId' in req.body) settings.ticketCategoryId = SNOW.test(req.body.ticketCategoryId) ? req.body.ticketCategoryId : null;
  if ('ticketLogChannelId' in req.body) settings.ticketLogChannelId = SNOW.test(req.body.ticketLogChannelId) ? req.body.ticketLogChannelId : null;
  if ('ticketMessage' in req.body) settings.ticketMessage = String(req.body.ticketMessage || '').trim().slice(0, 1000) || 'Опишите вашу проблему, и скоро вам ответит команда сервера.';
  // the older single staff role becomes the first of the list
  if (values.supportRoles) settings.ticketSupportRoleId = values.supportRoles[0] || null;
  await settings.save();
  if (wantsJson) return res.json({ ok: true });
  res.redirect(saved(guildId, 'tickets'));
});

// Posts the panel into the chosen channel, or edits the one already there.
router.post('/:guildId/tickets/publish', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const client = getClient();
  if (!client) return res.redirect(saved(guildId, 'tickets', 'offline'));
  const channelId = String(req.body.channelId || '');
  if (!SNOW.test(channelId)) return res.redirect(saved(guildId, 'tickets', 'invalid'));
  try {
    const r = await tickets().publishPanel(client, guildId, channelId);
    res.redirect(saved(guildId, 'tickets', r.edited ? 'panelupdated' : 'panelposted'));
  } catch (err) {
    res.redirect(saved(guildId, 'tickets', err.user ? 'invalid' : 'noperm'));
  }
});

// ---- «Обращения»: the open ones and the recently closed, with the transcript and closing from the panel ----
router.get('/:guildId/tickets-list', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { Ticket } = require('../../../db');
  const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const q = String(req.query.q || '').trim();
  const where = { guildId };
  if (status !== 'all') where.status = status;
  if (/^\d{15,25}$/.test(q)) where.userId = q;
  const [guild, settings, rows, open, closed, rated] = await Promise.all([
    getGuild(guildId), getSettings(guildId),
    Ticket.findAll({ where, order: [['id', 'DESC']], limit: 100, attributes: { exclude: ['transcript'], include: [[Ticket.sequelize.literal('LENGTH(transcript)'), 'tlen']] } }),
    Ticket.count({ where: { guildId, status: 'open' } }), Ticket.count({ where: { guildId, status: 'closed' } }),
    Ticket.findAll({ where: { guildId, rating: { [Op.ne]: null } }, attributes: ['rating'], raw: true })
  ]);
  const users = await getUsers([...new Set(rows.flatMap((t) => [t.userId, t.closedBy]).filter(Boolean))]);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : null;
  res.render('dashboard/tickets-list', { guild, settings, active: 'tickets-list', rows, users, status, q, counts: { open, closed }, rating: avg ? { avg, n: rated.length } : null, botOnline: Boolean(getClient()) });
});

router.get('/:guildId/tickets/:id(\\d+)/transcript', ensureGuildAccess, async (req, res) => {
  const { Ticket } = require('../../../db');
  const t = await Ticket.findOne({ where: { id: Number(req.params.id), guildId: req.params.guildId } });
  if (!t || !t.transcript) return res.status(404).render('error', { message: 'Переписки этого обращения нет: оно открыто, или её не сохраняли.' });
  res.set('Content-Type', 'text/plain; charset=utf-8');
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="ticket-${tickets().pad(t.number)}.txt"`);
  res.send(t.transcript);
});

router.post('/:guildId/tickets/:id(\\d+)/close', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const r = await tickets().closeById(getClient(), guildId, Number(req.params.id), req.user?.id || null, String(req.body.reason || '').slice(0, 250) || null);
  res.redirect(saved(guildId, 'tickets-list', r.ok ? 'ticketclosed' : r.why === 'offline' ? 'offline' : 'invalid'));
});

// ---- «Где и для кого работает модуль»: the same block on several pages ----
router.post('/:guildId/scope/:module', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const mod = String(req.params.module);
  if (!mc.SCOPE_MODULES.includes(mod)) return res.status(404).json({ ok: false });
  const { values, fieldErrors } = mc.scopeFromForm(req.body);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  const back = String(req.get('referer') || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const page = back.startsWith(`/dashboard/${guildId}/`) ? back.slice(`/dashboard/${guildId}/`.length) : '';
  if (Object.keys(fieldErrors).length) return wantsJson ? res.status(400).json({ ok: false, fieldErrors }) : res.redirect(page ? saved(guildId, page, 'invalid') : `/dashboard/${guildId}`);
  const settings = await getSettings(guildId);
  mc.writeScope(settings, mod, values);
  await settings.save();
  if (wantsJson) return res.json({ ok: true });
  res.redirect(page ? saved(guildId, page) : `/dashboard/${guildId}`);
});

module.exports = router;
