const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { settingsChanged } = require('../../botBridge');
const { getGuildChannels, getGuild, getGuildRoles, botApi } = require('../../discordApi');
const { CATEGORIES, KEYS: LOG_KEYS } = require('../../../bot/utils/logCategories');
const { setupLogForum } = require('../../utils/logForum');
const { parseJson, snowflake, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Logs: the "Логи" forum (one post per kind of event, filled through a webhook) ----

router.get('/:guildId/logs', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels, roles] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId).catch(() => [])]);
  res.render('dashboard/logs', {
    guild,
    settings,
    channels,
    roles: (roles || []).filter((r) => r.id !== req.params.guildId && !r.managed).sort((a, b) => b.position - a.position),
    ignoreChannels: parseJson(settings.logIgnoreChannels, []),
    ignoreRoles: parseJson(settings.logIgnoreRoles, []),
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
  // What is left out: only channels and roles of this server, at most 100 of each
  const [allChannels, allRoles] = await Promise.all([getGuildChannels(guildId), getGuildRoles(guildId).catch(() => [])]);
  const list = (v) => [].concat(v || []).map(snowflake).filter(Boolean);
  const chIds = new Set(allChannels.map((c) => c.id)); const roleIds = new Set((allRoles || []).map((r) => r.id));
  settings.logIgnoreChannels = JSON.stringify([...new Set(list(req.body.logIgnoreChannels))].filter((id) => chIds.has(id)).slice(0, 100));
  settings.logIgnoreRoles = JSON.stringify([...new Set(list(req.body.logIgnoreRoles))].filter((id) => roleIds.has(id) && id !== guildId).slice(0, 100));
  settings.logIgnoreBots = req.body.logIgnoreBots === 'on';
  settingsChanged(guildId, 'logs');

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
