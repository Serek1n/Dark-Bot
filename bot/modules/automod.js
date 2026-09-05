const { ModLog } = require('../../db');

const INVITE_REGEX = /(discord\.gg|discord(app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;

// guildId -> userId -> array of timestamps (ms) of recent messages
const recentMessages = new Map();

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

function checkBannedWords(settings, content) {
  let banned = [];
  try {
    banned = JSON.parse(settings.automodBannedWords || '[]');
  } catch {
    banned = [];
  }
  const lower = content.toLowerCase();
  return banned.some((word) => word && lower.includes(word.toLowerCase()));
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
