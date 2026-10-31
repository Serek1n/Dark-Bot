const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, botApi } = require('../../discordApi');
const { InteractiveMessage } = require('../../../db');
const { clampInt, snowflake, saved } = require('../../utils/common');
const { roleGuard } = require('../../utils/roles');
const im = require('../../../bot/modules/interactive');
const { errorKey } = require('../../../bot/utils/discordErrors');

const router = express.Router();
const CHANNEL_TYPES = [0, 5];
const MAX_PER_GUILD = 20;
const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

// ---- "Интерактивные сообщения": buttons and drop-down lists that give roles ----
router.get('/:guildId/interactive', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, channels, allRoles, guard] = await Promise.all([getGuild(guildId), getGuildChannels(guildId), getGuildRoles(guildId), roleGuard(guildId, req.user?.id)]);
  const messages = (await InteractiveMessage.findAll({ where: { guildId }, order: [['id', 'DESC']] })).map((m) => ({ ...m.toJSON(), items: im.parseItems(m.items) }));
  res.render('dashboard/interactive', { guild, channels: channels.filter((c) => CHANNEL_TYPES.includes(c.type)), allChannels: channels, roles: guard.annotate(allRoles), messages, max: MAX_PER_GUILD, maxItems: im.MAX_ITEMS, active: 'interactive' });
});

router.post('/:guildId/interactive', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const b = req.body;
  const channelId = snowflake(b.channelId);
  const content = String(b.content || '').trim().slice(0, 2000);
  const kind = b.kind === 'select' ? 'select' : 'buttons';
  const mode = im.MODES.includes(b.mode) ? b.mode : 'toggle';
  const labels = list(b.label), emojis = list(b.emoji), styles = list(b.style), roles = list(b.role), descs = list(b.description);
  const items = [];
  for (let i = 0; i < Math.min(roles.length, im.MAX_ITEMS); i++) {
    const roleId = snowflake(roles[i]);
    if (!roleId) continue;
    items.push({
      label: String(labels[i] || '').trim().slice(0, 80),
      emoji: String(emojis[i] || '').trim().slice(0, 64),
      style: Object.keys(im.STYLES).includes(styles[i]) ? styles[i] : 'secondary',
      description: String(descs[i] || '').trim().slice(0, 100),
      roleIds: [roleId]
    });
  }
  const back = (flag) => res.redirect(saved(guildId, 'interactive', flag));
  if (!channelId || !content || !items.length) return back('invalid');
  if (!(await getGuildChannels(guildId)).some((c) => c.id === channelId && CHANNEL_TYPES.includes(c.type))) return back('badchannel');
  if (items.some((it) => it.emoji && !im.emojiOf(it.emoji))) return back('invalid');
  const guard = await roleGuard(guildId, req.user?.id);
  if (items.some((it) => guard.check(it.roleIds[0]))) return back('rolenotallowed'); // the same rule as every other place that hands out roles
  if ((await InteractiveMessage.count({ where: { guildId } })) >= MAX_PER_GUILD) return back('toomany');

  const rec = await InteractiveMessage.create({ guildId, channelId, content, kind, mode, exclusive: b.exclusive === 'on', placeholder: String(b.placeholder || '').trim().slice(0, 150) || null, items: JSON.stringify(items), createdBy: req.user?.id || null });
  try {
    const p = im.payloadFor(rec);
    const { data } = await botApi.post(`/channels/${channelId}/messages`, { embeds: p.embeds.map((e) => e.toJSON()), components: p.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } });
    rec.messageId = data.id;
    await rec.save();
    return back('saved');
  } catch (err) {
    await rec.destroy();
    const key = errorKey(err);
    return res.redirect(`/dashboard/${guildId}/interactive?whfail=1&reason=${key === 'perm' ? 'panelperm' : key}`);
  }
});

router.post('/:guildId/interactive/:id/delete', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const rec = await InteractiveMessage.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (rec) {
    if (rec.messageId) await botApi.delete(`/channels/${rec.channelId}/messages/${rec.messageId}`).catch(() => {});
    await rec.destroy();
  }
  res.redirect(saved(guildId, 'interactive', 'deleted'));
});

module.exports = router;
