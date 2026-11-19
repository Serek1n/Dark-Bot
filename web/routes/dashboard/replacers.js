const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getClient } = require('../../botBridge');

const router = express.Router();

// Preview of a template for the person who is editing it: they play the member, this server is the server.
router.post('/:guildId/replacers/preview', ensureGuildAccess, express.json({ limit: '16kb' }), async (req, res) => {
  const { render, buildContext } = require('../../../bot/utils/replacers');
  const text = String(req.body?.text || '').slice(0, 4000);
  const guild = getClient()?.guilds.cache.get(req.params.guildId) || null;
  const member = guild ? await guild.members.fetch(req.user?.id).catch(() => null) : null;
  const stand = member || { id: req.user?.id || '0', displayName: req.user?.global_name || req.user?.username || 'Участник', user: { username: req.user?.username || 'user' } };
  const level = /level\./.test(text) ? await require('../../../bot/modules/leveling').levelContext(req.params.guildId, stand.id).catch(() => null) : null;
  const ctx = buildContext({ member: stand, guild: guild || { id: req.params.guildId, name: 'сервер', memberCount: 0, channels: { cache: new Map() } }, level });
  const legacy = { user: `@${stand.displayName}`, name: stand.displayName, server: guild?.name || 'сервер', count: guild?.memberCount ?? '', level: level?.level ?? 5, oldLevel: 4, crystals: 1, role: 'Роль', url: 'https://example.com' };
  // mentions are shown as readable names in the preview
  const out = render(text, ctx, legacy).replace(/<@!?(\d+)>/g, (m, id) => (id === stand.id ? `@${stand.displayName}` : '@участник')).replace(/<#(\d+)>/g, '#канал').replace(/<@&(\d+)>/g, '@роль');
  res.json({ ok: true, text: out });
});

// The names a message preview needs (web/public/js/dcp.js): roles with their colours, channels, the server's emoji, the
// bot and the person who looks (so <@id> of themselves reads as their name). Private to the panel; cached by the browser
// for a minute.
router.get('/:guildId/preview-context', ensureGuildAccess, async (req, res) => {
  const client = getClient();
  const guild = client?.guilds?.cache?.get(req.params.guildId) || null;
  const api = require('../../discordApi');
  let roles = []; let channels = [];
  if (guild) {
    roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.color || 0 }));
    channels = [...guild.channels.cache.values()].sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0)).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  } else {
    roles = (await api.getGuildRoles(req.params.guildId).catch(() => [])).filter((r) => r.id !== req.params.guildId).map((r) => ({ id: r.id, name: r.name, color: r.color || 0 }));
    channels = (await api.getGuildChannels(req.params.guildId).catch(() => [])).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  }
  const emojis = guild ? [...guild.emojis.cache.values()].slice(0, 200).map((e) => ({ id: e.id, name: e.name, animated: Boolean(e.animated) })) : [];
  const me = client?.user;
  const u = req.user || {};
  res.set('Cache-Control', 'private, max-age=60');
  res.json({
    guildName: guild?.name || '',
    bot: { name: guild?.members?.me?.displayName || me?.username || 'Dark', avatar: me?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '', verified: Boolean(me?.flags?.has?.('VerifiedBot')) },
    user: { id: u.id || '', name: u.global_name || u.username || '', avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : '' },
    roles: roles.slice(0, 250), channels: channels.slice(0, 500), emojis
  });
});

module.exports = router;
