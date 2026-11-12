// Sends event logs into the "Логи" forum through a webhook (one thread per category).
// The panel creates the forum structure; the bot only reads it from the settings and posts.
const { WebhookClient } = require('discord.js');
const { GuildSettings } = require('../../db');
const embeds = require('../utils/embeds');

let avatarUrl = null; // the bot's avatar: the webhook posts with it
const setAvatar = (url) => { avatarUrl = url || null; };
const logger = require('../utils/logger');

const CONFIG_TTL = 30_000; // the panel runs in another process, so changes arrive within this time
const configs = new Map(); // guildId -> { at, cfg }
const clients = new Map(); // webhookId:token -> WebhookClient

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** The log setup of a guild, or null when the forum is not connected. Cached for 30 seconds. */
async function getConfig(guildId) {
  const hit = configs.get(guildId);
  if (hit && Date.now() - hit.at < CONFIG_TTL) return hit.cfg;
  let cfg = null;
  try {
    const s = await GuildSettings.findOne({
      where: { guildId },
      attributes: ['logsEnabled', 'logForumChannelId', 'logWebhookId', 'logWebhookToken', 'logThreads', 'logDisabled', 'logIgnoreChannels', 'logIgnoreRoles', 'logIgnoreBots']
    });
    if (s?.logsEnabled !== false && s?.logForumChannelId && s.logWebhookId && s.logWebhookToken) { // module off: nothing is written
      const threads = parseJson(s.logThreads, {});
      cfg = {
        webhookId: s.logWebhookId,
        token: s.logWebhookToken,
        threads,
        threadIds: new Set(Object.values(threads)),
        disabled: new Set(parseJson(s.logDisabled, [])),
        ignoreChannels: new Set(parseJson(s.logIgnoreChannels, [])),
        ignoreRoles: new Set(parseJson(s.logIgnoreRoles, [])),
        ignoreBots: Boolean(s.logIgnoreBots)
      };
    }
  } catch (err) {
    logger.error('Log config error:', err);
  }
  configs.set(guildId, { at: Date.now(), cfg });
  if (configs.size > 1000) configs.delete(configs.keys().next().value);
  return cfg;
}

const invalidate = (guildId) => configs.delete(guildId);

/**
 * True when an event must be left out of the logs by the server's "Что не записывать" settings:
 * a channel (or the channel a thread belongs to) on the list, a bot or webhook when bots are off, a member with a listed role.
 */
function skipped(cfg, { channel, channelId, parentId, member, isBot } = {}) {
  if (!cfg) return false;
  const ids = [channelId, channel?.id, parentId, channel?.parentId].filter(Boolean);
  if (cfg.ignoreChannels?.size && ids.some((id) => cfg.ignoreChannels.has(id))) return true;
  if (cfg.ignoreBots && isBot) return true;
  if (cfg.ignoreRoles?.size && member?.roles?.cache?.has && [...cfg.ignoreRoles].some((id) => member.roles.cache.has(id))) return true;
  return false;
}

/** True when logs of this category are being collected for the guild. */
async function isOn(guildId, key) {
  const cfg = await getConfig(guildId);
  return Boolean(cfg && cfg.threads[key] && !cfg.disabled.has(key));
}

function clientFor(cfg) {
  const id = `${cfg.webhookId}:${cfg.token}`;
  let c = clients.get(id);
  if (!c) {
    c = new WebhookClient({ id: cfg.webhookId, token: cfg.token });
    clients.set(id, c);
  }
  return c;
}

/** Posts an embed into the category thread. Never throws: logging must not break the bot. */
async function sendLog(guildId, key, embed) {
  const cfg = await getConfig(guildId);
  if (!cfg || cfg.disabled.has(key) || !cfg.threads[key]) return false;
  try {
    await clientFor(cfg).send({
      threadId: cfg.threads[key],
      username: 'Dark · Логи',
      ...(avatarUrl ? { avatarURL: avatarUrl } : {}),
      embeds: [embed],
      allowedMentions: { parse: [] }
    });
    return true;
  } catch (err) {
    // 10015 = the webhook was deleted, 10003 = the thread was deleted: the panel's button rebuilds them.
    if (err?.code === 10015 || err?.code === 10003) invalidate(guildId);
    logger.warn(`Log send failed (${key}): ${err?.message || err}`);
    return false;
  }
}

/** Builds the embed lazily: nothing is computed for guilds without this category. */
async function log(guildId, key, build) {
  if (!(await isOn(guildId, key))) return false;
  const embed = await build(embeds.baseEmbed); // builders may look the actor up in the audit log
  return embed ? sendLog(guildId, key, embed) : false;
}

// ---- Message memory: edits and deletions do not carry the old text, so recent messages are kept here ----
const MAX_MESSAGES = 3_000; // about 10 MB at most: enough for the edits and deletions of the last hours on a busy server
const messageCache = new Map(); // id -> { content, authorId, channelId, webhookId, attachments }

function remember(message) {
  messageCache.set(message.id, {
    content: String(message.content || '').slice(0, 1500),
    authorId: message.author?.id || null,
    channelId: message.channelId,
    webhookId: message.webhookId || null,
    isBot: Boolean(message.author?.bot || message.webhookId),
    parentId: message.channel?.parentId || null,
    attachments: [...(message.attachments?.values?.() || [])].slice(0, 10).map((a) => ({ name: a.name, url: a.url, size: a.size }))
  });
  if (messageCache.size > MAX_MESSAGES) messageCache.delete(messageCache.keys().next().value);
}
const recall = (id) => messageCache.get(id);
const forget = (id) => {
  const m = messageCache.get(id);
  messageCache.delete(id);
  return m;
};

// ---- Actions already reported by the bot's own /mod commands, so the same ban is not logged twice ----
const reported = new Map(); // "guild:user:action" -> time
function markReported(guildId, userId, action) {
  reported.set(`${guildId}:${userId}:${action}`, Date.now());
  if (reported.size > 500) for (const [k, t] of reported) if (Date.now() - t > 30_000) reported.delete(k);
}
const wasReported = (guildId, userId, action) => Date.now() - (reported.get(`${guildId}:${userId}:${action}`) || 0) < 15_000;

module.exports = { setAvatar, getConfig, invalidate, skipped, isOn, sendLog, log, remember, recall, forget, markReported, wasReported };
