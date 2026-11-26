const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getGuildRoles, getUsers } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');
const access = require('../../utils/access');
const audit = require('../../utils/audit');

// ---- «Настройки панели» → «Права доступа»: who may use the panel without managing the server, and what ----
const router = express.Router();
const SNOW = /^\d{15,25}$/;

router.get('/:guildId/access', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { PanelRoleAccess, PanelAudit } = require('../../../db');
  const [guild, settings, roles, channels, rows, log] = await Promise.all([
    getGuild(guildId), getSettings(guildId), getGuildRoles(guildId), getGuildChannels(guildId),
    PanelRoleAccess.findAll({ where: { guildId }, order: [['targetType', 'ASC'], ['id', 'ASC']] }),
    PanelAudit.findAll({ where: { guildId }, order: [['id', 'DESC']], limit: 50 })
  ]);
  const users = await getUsers([...new Set([...rows.filter((r) => r.targetType === 'user').map((r) => r.targetId), ...rows.map((r) => r.updatedBy), ...log.map((l) => l.userId)].filter(Boolean))]);
  const byRole = new Map(roles.map((r) => [r.id, r]));
  const entries = rows.map((r) => ({ id: r.id, type: r.targetType, targetId: r.targetId, scopes: access.parseScopes(r.scopes), presetId: r.presetId, updatedBy: r.updatedBy, updatedAt: r.updatedAt,
    role: r.targetType === 'role' ? byRole.get(r.targetId) || null : null, user: r.targetType === 'user' ? users[r.targetId] || null : null }));
  const me = req.access;
  const canStrict = me.full && ['owner', 'admin', 'bot-owner'].includes(me.reason);
  res.render('dashboard/access', {
    guild, settings, active: 'access', entries, users, log, LABELS: audit.LABELS, A: access, canStrict, myTop: me.member?.top ?? Infinity,
    roles: roles.filter((r) => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position), channels: channels.filter((c) => c.type === 0 || c.type === 5),
    myScopes: [...me.scopes], full: me.full, err: String(req.query.why || '').slice(0, 300)
  });
});

/** Adds or changes the entry of a role or a member. */
router.post('/:guildId/access/save', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { PanelRoleAccess } = require('../../../db');
  const type = req.body.targetType === 'user' ? 'user' : 'role';
  const targetId = String(req.body.targetId || '').trim();
  const back = (why) => res.redirect(`/dashboard/${guildId}/access?invalid=1&why=${encodeURIComponent(why)}`);
  if (!SNOW.test(targetId)) return back('Укажите роль или ID участника.');
  const roles = await getGuildRoles(guildId);
  const role = type === 'role' ? roles.find((r) => r.id === targetId) : null;
  if (type === 'role' && (!role || role.name === '@everyone')) return back('Такой роли на сервере нет.');
  let scopes = [].concat(req.body.scopes || []).map(String).filter((s) => access.SCOPE_KEYS.includes(s));
  const preset = access.PRESETS.find((p) => p[0] === req.body.presetId);
  if (preset && req.body.usePreset === '1') scopes = preset[2].slice();
  scopes = [...new Set(scopes)];
  if (!scopes.length) return back('Отметьте хотя бы одно право — или удалите запись.');
  const old = await PanelRoleAccess.findOne({ where: { guildId, targetType: type, targetId } });
  const verdict = access.mayEdit({ ...req.access, userId: req.user.id }, { type, id: targetId, position: role?.position, scopes, old: old ? access.parseScopes(old.scopes) : [] });
  if (!verdict.ok) return back(verdict.why);
  if (old) { old.scopes = JSON.stringify(scopes); old.presetId = preset ? preset[0] : null; old.updatedBy = req.user.id; await old.save(); } else {
    await PanelRoleAccess.create({ guildId, targetType: type, targetId, scopes: JSON.stringify(scopes), presetId: preset ? preset[0] : null, updatedBy: req.user.id });
  }
  access.forgetGuild(guildId);
  const name = type === 'role' ? `роли @${role.name}` : `участнику ${targetId}`;
  await audit.record(guildId, req.user.id, 'access.grant', `${old ? 'изменил права' : 'выдал права'} ${name}: ${scopes.map((s) => access.SCOPE_TITLE[s]).join(', ')}`);
  res.redirect(saved(guildId, 'access'));
});

router.post('/:guildId/access/:id(\\d+)/delete', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { PanelRoleAccess } = require('../../../db');
  const row = await PanelRoleAccess.findOne({ where: { id: Number(req.params.id), guildId } });
  if (!row) return res.redirect(saved(guildId, 'access', 'invalid'));
  const role = row.targetType === 'role' ? (await getGuildRoles(guildId)).find((r) => r.id === row.targetId) : null;
  const verdict = access.mayEdit({ ...req.access, userId: req.user.id }, { type: row.targetType, id: row.targetId, position: role?.position, scopes: [], old: access.parseScopes(row.scopes) });
  if (!verdict.ok) return res.redirect(`/dashboard/${guildId}/access?invalid=1&why=${encodeURIComponent(verdict.why)}`);
  await row.destroy();
  access.forgetGuild(guildId);
  await audit.record(guildId, req.user.id, 'access.revoke', `снял все права ${row.targetType === 'role' ? `роли @${role ? role.name : row.targetId}` : `участника ${row.targetId}`}`);
  res.redirect(saved(guildId, 'access'));
});

// The strict mode (only the owner and administrators may switch it) and the channel of the panel's log.
router.post('/:guildId/access/settings', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const me = req.access;
  if (!me.full) return access.forbidden(req, res, []);
  const changes = [];
  if ('panelStrict' in req.body || req.body._fields?.includes('panelStrict')) {
    const strict = req.body.panelStrict === 'on';
    if (strict !== Boolean(settings.panelStrict)) {
      if (!['owner', 'admin', 'bot-owner'].includes(me.reason)) return res.redirect(`/dashboard/${guildId}/access?invalid=1&why=${encodeURIComponent('Строгий режим включают и выключают только владелец и администраторы сервера.')}`);
      settings.panelStrict = strict; changes.push(strict ? 'включил строгий режим' : 'выключил строгий режим');
    }
  }
  if ('panelAuditChannelId' in req.body) {
    const id = SNOW.test(req.body.panelAuditChannelId) ? req.body.panelAuditChannelId : null;
    if (id !== settings.panelAuditChannelId) { settings.panelAuditChannelId = id; changes.push(id ? `журнал панели в <#${id}>` : 'журнал панели не в канале'); }
  }
  await settings.save();
  access.forgetGuild(guildId);
  if (changes.length) await audit.record(guildId, req.user.id, 'access.settings', changes.join('; '));
  res.redirect(saved(guildId, 'access'));
});

module.exports = router;
