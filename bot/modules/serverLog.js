// Sends event logs into the "Логи" forum through a webhook (one thread per category).
// The panel creates the forum structure; the bot only reads it from the settings and posts.
const { WebhookClient } = require('discord.js');
const { GuildSettings } = require('../../db');
const embeds = require('../utils/embeds');
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
      attributes: ['logForumChannelId', 'logWebhookId', 'logWebhookToken', 'logThreads', 'logDisabled']
    });
    if (s?.logForumChannelId && s.logWebhookId && s.logWebhookToken) {
      const threads = parseJson(s.logThreads, {});
      cfg = {
        webhookId: s.logWebhookId,
        token: s.logWebhookToken,
        threads,
        threadIds: new Set(Object.values(threads)),
        disabled: new Set(parseJson(s.logDisabled, []))
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
  const embed = build(embeds.baseEmbed);
  return embed ? sendLog(guildId, key, embed) : false;
}

// ---- Message memory: edits and deletions do not carry the old text, so recent messages are kept here ----
const MAX_MESSAGES = 10_000;
const messageCache = new Map(); // id -> { content, authorId, channelId, webhookId, attachments }

function remember(message) {
  messageCache.set(message.id, {
    content: String(message.content || '').slice(0, 1500),
    authorId: message.author?.id || null,
    channelId: message.channelId,
    webhookId: message.webhookId || null,
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

module.exports = { getConfig, invalidate, isOn, sendLog, log, remember, recall, forget, markReported, wasReported };
