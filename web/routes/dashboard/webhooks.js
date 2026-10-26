const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, botApi } = require('../../discordApi');
const { GuildSettings } = require('../../../db');
const { snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Webhooks ----
const webhooks = require('../../webhooks');
const { isEnabled, disabledText } = require('../../../bot/utils/features');
const { rateLimit } = require('../../middleware/rateLimit');
const webhookLimit = rateLimit({ windowMs: 60_000, max: 10, message: 'Слишком много действий с вебхуками. Подождите минуту.' });
const BOT_ID = () => process.env.DISCORD_CLIENT_ID;
const WEBHOOK_CHANNEL_TYPES = [0, 2, 5, 13, 15, 16];
// Errors travel as a short code (`reason`), turned into text by the page: a link cannot carry arbitrary words to show.
const webhookPage = (guildId, flag, reason) => `/dashboard/${guildId}/webhooks?${flag}=1${reason ? '&reason=' + reason : ''}`;

router.get('/:guildId/webhooks', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const guild = await getGuild(guildId);
  const channels = (await getGuildChannels(guildId)).filter((c) => WEBHOOK_CHANNEL_TYPES.includes(c.type));
  const settings = await GuildSettings.findByPk(guildId);
  let hooks = []; let error = null;
  try { hooks = await webhooks.listOwn(guildId, BOT_ID(), settings?.logWebhookId); } catch (err) { error = webhooks.explain(err); }
  res.render('dashboard/webhooks', { guild, channels, settings, hooks, error, featureOff: !isEnabled(settings, 'webhooks'), disabledNote: disabledText(settings, 'webhooks'), active: 'webhooks' });
});

router.post('/:guildId/webhooks', webhookLimit, ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const channelId = snowflake(req.body.channelId);
  const name = String(req.body.name || '').trim().slice(0, 32);
  if (!channelId || !name) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
  const channels = await getGuildChannels(guildId);
  if (!channels.some((c) => c.id === channelId && WEBHOOK_CHANNEL_TYPES.includes(c.type))) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
  try {
    await webhooks.create(channelId, name, String(req.body.avatarUrl || '').trim() || null, `Создан через веб-панель (${req.user?.username || req.session?.user?.username || 'админ'})`);
    res.redirect(webhookPage(guildId, 'created'));
  } catch (err) {
    res.redirect(webhookPage(guildId, 'whfail', webhooks.explainKey(err)));
  }
});

router.post('/:guildId/webhooks/panel', webhookLimit, ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const channelId = snowflake(req.body.channelId);
  const channels = await getGuildChannels(guildId);
  if (!channelId || !channels.some((c) => c.id === channelId && [0, 5].includes(c.type))) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
  const settings = await getSettings(guildId);
  const payload = require('../../../bot/modules/webhookPanel').panelPayload();
  try {
    const { data } = await botApi.post(`/channels/${channelId}/messages`, { embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } });
    if (settings.webhookPanelChannelId && settings.webhookPanelMessageId) { // the older panel is replaced, not left next to the new one
      await botApi.delete(`/channels/${settings.webhookPanelChannelId}/messages/${settings.webhookPanelMessageId}`).catch(() => {});
    }
    settings.webhookPanelChannelId = channelId;
    settings.webhookPanelMessageId = data.id;
    await settings.save();
    res.redirect(saved(guildId, 'webhooks', 'wpanel'));
  } catch (err) {
    res.redirect(webhookPage(guildId, 'whfail', webhooks.explainKey(err) === 'perm' ? 'panelperm' : 'panel'));
  }
});

router.post('/:guildId/webhooks/:id/delete', webhookLimit, ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const settings = await GuildSettings.findByPk(guildId);
  try {
    const hook = (await webhooks.listOwn(guildId, BOT_ID(), settings?.logWebhookId)).find((w) => w.id === req.params.id);
    if (!hook) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
    await webhooks.remove(hook.id, 'Удалён через веб-панель');
    res.redirect(saved(guildId, 'webhooks', 'deleted'));
  } catch (err) {
    res.redirect(webhookPage(guildId, 'whfail', webhooks.explainKey(err)));
  }
});

router.post('/:guildId/webhooks/:id/send', webhookLimit, ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const framed = req.body.style !== 'plain';
  const content = String(req.body.content || '').trim().slice(0, framed ? 4000 : 2000);
  if (!content) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
  const settings = await GuildSettings.findByPk(guildId);
  try {
    const hook = (await webhooks.listOwn(guildId, BOT_ID(), settings?.logWebhookId)).find((w) => w.id === req.params.id);
    if (!hook) return res.redirect(saved(guildId, 'webhooks', 'invalid'));
    await webhooks.send(hook, { content, framed, title: String(req.body.title || '').trim().slice(0, 256), username: String(req.body.username || '').trim().slice(0, 80) || null });
    res.redirect(webhookPage(guildId, 'whsent'));
  } catch (err) {
    res.redirect(webhookPage(guildId, 'whfail', webhooks.explainKey(err)));
  }
});

module.exports = router;
