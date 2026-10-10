const { ModLog } = require('../../db');

const INVITE_REGEX = /(discord\.gg|discord(app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;

// guildId:userId -> array of timestamps (ms) of recent messages
const recentMessages = new Map();

// Drop stale entries so the map doesn't grow forever on busy servers.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, arr] of recentMessages) {
    if (!arr.length || arr[arr.length - 1] < cutoff) recentMessages.delete(key);
  }
}, 5 * 60 * 1000).unref();

function checkSpam(settings, guildId, userId) {
  if (!settings.automodAntiSpam) return false;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = settings.automodSpamSeconds * 1000;

  const arr = (recentMessages.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  recentMessages.set(key, arr);

  return arr.length > settings.automodSpamMessages;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A banned word matches when it STARTS a word, so "ass" no longer deletes "class" or "assistant"
// in the middle of a word, while inflected forms ("слово" -> "словом") are still caught.
const wordRegexCache = new Map();
function wordRegex(word) {
  let re = wordRegexCache.get(word);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}`, 'iu');
    wordRegexCache.set(word, re);
    if (wordRegexCache.size > 2000) wordRegexCache.clear();
  }
  return re;
}

function checkBannedWords(settings, content) {
  let banned = [];
  try {
    banned = JSON.parse(settings.automodBannedWords || '[]');
  } catch {
    banned = [];
  }
  return banned.some((word) => word && wordRegex(word.trim()).test(content));
}

function checkInvite(settings, content) {
  if (!settings.automodBlockInvites) return false;
  return INVITE_REGEX.test(content);
}

/**
 * Runs automod on a message. Returns a reason string if it should be deleted, otherwise null.
 */
async function evaluateMessage(settings, message) {
  if (!settings.automodEnabled) return null;
  if (message.member?.permissions?.has('ManageMessages')) return null; // exempt mods

  if (checkBannedWords(settings, message.content)) return 'запрещённое слово';
  if (checkInvite(settings, message.content)) return 'ссылка-приглашение на другой сервер';
  if (checkSpam(settings, message.guildId, message.author.id)) return 'спам (слишком много сообщений подряд)';

  return null;
}

async function logModAction(guildId, userId, moderatorId, action, reason) {
  return ModLog.create({ guildId, userId, moderatorId, action, reason });
}

module.exports = { evaluateMessage, logModAction };
