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

// «Базовые настройки»: what belongs to the whole bot on this server, not to one module (its language, its time zone)
router.get('/:guildId/settings', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  const P = require('../../utils/portability');
  // the result of a loaded file: kept, matched by name and left out (the names of what was not found)
  let imported = null;
  try { imported = req.query.imp ? JSON.parse(Buffer.from(String(req.query.imp), 'base64url').toString('utf8')) : null; } catch { imported = null; }
  res.render('dashboard/settings', { guild, settings, Z: require('../../../shared/zones'), active: 'settings', brand: require('../../../bot/utils/moduleConfig').read(settings, 'brand'), MODULE_TITLES: P.MODULE_TITLES, imported });
});

// ---- «Перенос настроек»: the file, loading it here, a module back to its defaults ----
router.get('/:guildId/settings/export', ensureGuildAccess, async (req, res) => {
  const { getGuildChannels, getGuildRoles } = require('../../discordApi');
  const [guild, settings, channels, roles] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId).catch(() => []), getGuildRoles(req.params.guildId).catch(() => [])]);
  const file = require('../../utils/portability').exportSettings(settings, { guild, channels, roles });
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="dark-settings-${req.params.guildId}.json"`);
  res.send(JSON.stringify(file, null, 2));
});
router.post('/:guildId/settings/import', express.urlencoded({ extended: true, limit: '2mb' }), ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { getGuildChannels, getGuildRoles } = require('../../discordApi');
  let file;
  try { file = JSON.parse(String(req.body.json || '')); } catch { return res.redirect(saved(guildId, 'settings', 'invalid')); }
  const [settings, channels, roles] = await Promise.all([getSettings(guildId), getGuildChannels(guildId).catch(() => []), getGuildRoles(guildId).catch(() => [])]);
  let r;
  try { r = require('../../utils/portability').importSettings(file, { attributes: settings.constructor.rawAttributes, channels, roles }); } catch (err) { return res.redirect(saved(guildId, 'settings', 'invalid')); }
  Object.assign(settings, r.values);
  await settings.save();
  require('../../../bot/modules/branding').forget(guildId);
  const imp = Buffer.from(JSON.stringify({ kept: r.report.kept, mapped: r.report.mapped, dropped: r.report.dropped.slice(0, 20).map((d) => d.name || d.id), more: Math.max(0, r.report.dropped.length - 20) })).toString('base64url');
  res.redirect(`/dashboard/${guildId}/settings?importdone=1&imp=${imp}`);
});
router.post('/:guildId/settings/reset-module', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const done = require('../../utils/portability').resetModule(settings, String(req.body.module || ''), settings.constructor.rawAttributes);
  if (!done.length) return res.redirect(saved(guildId, 'settings', 'invalid'));
  await settings.save();
  require('../../../bot/modules/branding').forget(guildId);
  res.redirect(saved(guildId, 'settings', 'moduleReset'));
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
  res.redirect(saved(req.params.guildId, 'settings'));
});

router.post('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  FEATURES.forEach((f) => { settings[f.field] = req.body[f.field] === 'on'; });
  await settings.save();
  res.redirect(saved(req.params.guildId, 'features'));
});

// One module on or off, from a switch (the top menu, a module's header, the home page, the modules page). Answers JSON
// for the switch; a form without scripts gets the page back. "also" switches off the modules that depend on this one
// (Магазин without Экономика) when the person ticked them in the dialog.
router.post('/:guildId/modules/:key', ensureGuildAccess, async (req, res) => {
  const { BY_KEY, dependentsOf } = require('../../modules');
  const m = BY_KEY.get(req.params.key);
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (!m || !m.field) return wantsJson ? res.status(404).json({ ok: false }) : res.redirect(`/dashboard/${req.params.guildId}/features`);
  const on = req.body.on === '1' || req.body.on === 'true' || req.body.on === 'on';
  const settings = await getSettings(req.params.guildId);
  const changed = [m.key];
  settings[m.field] = on;
  if (!on) {
    const allowed = new Set(dependentsOf(m.key));
    for (const k of [].concat(req.body.also || [])) {
      const d = BY_KEY.get(String(k));
      if (d && d.field && allowed.has(d.key)) { settings[d.field] = false; changed.push(d.key); }
    }
  }
  await settings.save();
  if (changed.includes('logs')) require('../../../bot/modules/serverLog').invalidate(req.params.guildId); // the logs stop/start now, not in 30 s
  if (wantsJson) return res.json({ ok: true, on, changed });
  const back = String(req.body.back || '');
  res.redirect(back.startsWith(`/dashboard/${req.params.guildId}`) ? back : saved(req.params.guildId, 'features'));
});

// "Доска почёта" was removed: an old bookmark opens the overview instead of an error.
router.get('/:guildId/starboard', (req, res) => {
  const id = require('../../utils/common').snowflake(req.params.guildId);
  res.redirect(301, id ? `/dashboard/${id}` : '/dashboard');
});

module.exports = router;
