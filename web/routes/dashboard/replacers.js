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

module.exports = router;
