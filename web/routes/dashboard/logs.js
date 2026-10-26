const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { settingsChanged } = require('../../botBridge');
const { getGuildChannels, getGuild, botApi } = require('../../discordApi');
const { CATEGORIES, KEYS: LOG_KEYS } = require('../../../bot/utils/logCategories');
const { setupLogForum } = require('../../utils/logForum');
const { parseJson, snowflake, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Logs: the "Логи" forum (one post per kind of event, filled through a webhook) ----

router.get('/:guildId/logs', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  res.render('dashboard/logs', {
    guild,
    settings,
    forums: channels.filter((c) => c.type === 15),
    categories: CATEGORIES,
    threads: parseJson(settings.logThreads, {}),
    disabled: new Set(parseJson(settings.logDisabled, [])),
    active: 'logs'
  });
});

router.post('/:guildId/logs', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const settings = await getSettings(guildId);
  const back = (flag) => res.redirect(`/dashboard/${guildId}/logs?${flag}=1`);

  // Disconnect: the posts stay in Discord, the bot just stops writing.
  if (req.body.action === 'off') {
    if (settings.logWebhookId) await botApi.delete(`/webhooks/${settings.logWebhookId}`, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Логи отключены') } }).catch(() => {});
    settings.logForumChannelId = null;
    settings.logWebhookId = null;
    settings.logWebhookToken = null;
    settings.logThreads = '{}';
    await settings.save();
    return back('logoff');
  }

  const enabled = new Set(LOG_KEYS.filter((k) => req.body['cat_' + k] === 'on'));
  settings.logDisabled = JSON.stringify(LOG_KEYS.filter((k) => !enabled.has(k)));

  const forumId = snowflake(req.body.logForumChannelId);
  if (!forumId) {
    await settings.save();
    return back('saved');
  }
  // Only a forum of this very server: the bot would otherwise retag and post into someone else's forum.
  const forums = (await getGuildChannels(guildId)).filter((c) => c.type === 15);
  if (!forums.some((c) => c.id === forumId)) {
    await settings.save();
    return back(forumId === settings.logForumChannelId ? 'saved' : 'lognoforum');
  }
  const sameForum = forumId === settings.logForumChannelId;
  if (sameForum && req.body.action !== 'setup' && settings.logWebhookId) {
    await settings.save();
    return back('saved');
  }

  try {
    const result = await setupLogForum(botApi, forumId, {
      webhookId: sameForum ? settings.logWebhookId : null,
      webhookToken: sameForum ? settings.logWebhookToken : null,
      threads: sameForum ? parseJson(settings.logThreads, {}) : {}
    });
    // Leaving an old forum: its webhook is no longer needed.
    if (!sameForum && settings.logWebhookId) await botApi.delete(`/webhooks/${settings.logWebhookId}`).catch(() => {});
    settings.logForumChannelId = forumId;
    settings.logWebhookId = result.webhookId;
    settings.logWebhookToken = result.webhookToken;
    settings.logThreads = JSON.stringify(result.threads);
    await settings.save();
    settingsChanged(guildId, 'logs'); // the bot starts using the new forum right away
    return back(result.created.length ? 'logready' : 'saved');
  } catch (err) {
    await settings.save();
    return back(err.code === 'notforum' ? 'lognoforum' : err.code === 'perm' ? 'logperm' : 'logfail');
  }
});

module.exports = router;
