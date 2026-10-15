// Automod: rules that look at a message, and what happens to the offender (delete / warn / mute).
const { ModLog } = require('../../db');
const mod = require('./moderation');
const { recordAndAnnounce } = require('../utils/modlog');
const { MINUTE, MAX_TIMEOUT } = require('../utils/duration');
const logger = require('../utils/logger');

const INVITE_REGEX = /(discord\.gg|discord(app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;
const URL_REGEX = /(?:https?:\/\/|www\.)([^\s/<>]+)/gi;
const MENTION_REGEX = /<@[!&]?(\d+)>|@everyone|@here/g;
const CUSTOM_EMOJI_REGEX = /<a?:\w+:\d+>/g;
const DUPLICATE_LIMIT = 3; // the same text this many times...
const DUPLICATE_WINDOW = 30_000; // ...within 30 seconds
const ACTION_COOLDOWN = 8_000; // one warning/mute per member per this time, even if he keeps spamming

// guildId:userId -> timestamps (ms) of recent messages / [{ t, text }] of recent texts
const recentMessages = new Map();
const recentTexts = new Map();
const lastPunished = new Map();

// Drop stale entries so the maps don't grow forever on busy servers.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, arr] of recentMessages) if (!arr.length || arr[arr.length - 1] < cutoff) recentMessages.delete(key);
  for (const [key, arr] of recentTexts) if (!arr.length || arr[arr.length - 1].t < cutoff) recentTexts.delete(key);
  for (const [key, t] of lastPunished) if (t < cutoff) lastPunished.delete(key);
}, 5 * 60 * 1000).unref();

const json = (text) => {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

function checkSpam(settings, guildId, userId) {
  if (!settings.automodAntiSpam) return false;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = settings.automodSpamSeconds * 1000;
  const arr = (recentMessages.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  if (arr.length > settings.automodSpamMessages) {
    recentMessages.delete(key); // count again from zero after the punishment
    return true;
  }
  recentMessages.set(key, arr);
  return false;
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
  return json(settings.automodBannedWords).some((word) => word && wordRegex(String(word).trim()).test(content));
}

function checkInvite(settings, content) {
  return Boolean(settings.automodBlockInvites) && INVITE_REGEX.test(content);
}

/** Any link whose site is not on the whitelist ("youtube.com" also allows "www.youtube.com" and "m.youtube.com"). */
function checkLinks(settings, content) {
  if (!settings.automodBlockLinks) return false;
  const allowed = json(settings.automodLinkWhitelist).map((d) => String(d).toLowerCase().trim()).filter(Boolean);
  for (const m of content.matchAll(URL_REGEX)) {
    const host = m[1].toLowerCase().replace(/:\d+$/, '').replace(/[.,;:!?)]+$/, '');
    if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  }
  return false;
}

function checkMentions(settings, content) {
  const limit = Number(settings.automodMentionLimit) || 0;
  if (!limit) return false;
  const unique = new Set([...content.matchAll(MENTION_REGEX)].map((m) => m[0]));
  return unique.size > limit;
}

function checkCaps(settings, content) {
  const percent = Number(settings.automodCapsPercent) || 0;
  if (!percent) return false;
  const letters = content.match(/\p{L}/gu) || [];
  if (letters.length < (Number(settings.automodCapsMinLength) || 10)) return false;
  const upper = content.match(/\p{Lu}/gu) || [];
  return (upper.length / letters.length) * 100 >= percent;
}

function checkEmoji(settings, content) {
  const limit = Number(settings.automodEmojiLimit) || 0;
  if (!limit) return false;
  const count = (content.match(CUSTOM_EMOJI_REGEX) || []).length + (content.replace(CUSTOM_EMOJI_REGEX, '').match(/\p{Extended_Pictographic}/gu) || []).length;
  return count > limit;
}

function checkDuplicates(settings, guildId, userId, content) {
  if (!settings.automodDuplicates) return false;
  const text = content.trim().toLowerCase();
  if (text.length < 3) return false;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const arr = (recentTexts.get(key) || []).filter((x) => now - x.t < DUPLICATE_WINDOW);
  arr.push({ t: now, text });
  const same = arr.filter((x) => x.text === text).length;
  if (same >= DUPLICATE_LIMIT) {
    recentTexts.delete(key);
    return true;
  }
  recentTexts.set(key, arr);
  return false;
}

/** Channels and roles the automod does not look at. */
function isExempt(settings, message) {
  if (message.member?.permissions?.has('ManageMessages')) return true; // mods are not checked
  if (message.channelId && json(settings.automodIgnoredChannels).includes(message.channelId)) return true;
  const ignored = json(settings.automodIgnoredRoles);
  const roles = message.member?.roles?.cache;
  return Boolean(ignored.length && roles && ignored.some((id) => roles.has(id)));
}

/**
 * Runs automod on a message. Returns a reason string if the message breaks a rule, otherwise null.
 */
async function evaluateMessage(settings, message) {
  if (!settings.automodEnabled) return null;
  if (isExempt(settings, message)) return null;
  const content = message.content || '';

  if (checkBannedWords(settings, content)) return 'запрещённое слово';
  if (checkInvite(settings, content)) return 'ссылка-приглашение на другой сервер';
  if (checkLinks(settings, content)) return 'ссылки здесь запрещены';
  if (checkMentions(settings, content)) return 'слишком много упоминаний';
  if (checkCaps(settings, content)) return 'слишком много заглавных букв';
  if (checkEmoji(settings, content)) return 'слишком много эмодзи';
  if (checkDuplicates(settings, message.guildId, message.author.id, content)) return 'повторяющиеся сообщения';
  if (checkSpam(settings, message.guildId, message.author.id)) return 'спам (слишком много сообщений подряд)';

  return null;
}

async function logModAction(guildId, userId, moderatorId, action, reason) {
  return ModLog.create({ guildId, userId, moderatorId, action, reason });
}

/**
 * What happens after a rule was broken: the message is deleted, then (by the server's choice)
 * the author is only noted, warned (which can escalate by the warning thresholds) or muted.
 */
async function handleViolation(settings, message, reason) {
  const guild = message.guild;
  const author = message.author;
  const botId = message.client.user.id;
  await message.delete().catch(() => {});

  const action = ['warn', 'mute'].includes(settings.automodAction) ? settings.automodAction : 'delete';
  const key = `${guild.id}:${author.id}`;
  const now = Date.now();
  const cooling = action !== 'delete' && now - (lastPunished.get(key) || 0) < ACTION_COOLDOWN;
  let note = null;

  if (action === 'warn' && !cooling) {
    lastPunished.set(key, now);
    const { count } = await mod.warnMember(guild, author, { moderatorId: botId, reason: `Автомодерация: ${reason}` });
    note = `предупреждение (${count})`;
  } else if (action === 'mute' && !cooling) {
    lastPunished.set(key, now);
    const member = message.member || (await guild.members.fetch(author.id).catch(() => null));
    const ms = Math.min(Math.max(Number(settings.automodMuteMinutes) || 10, 1) * MINUTE, MAX_TIMEOUT);
    try {
      if (!member) throw new Error('участника нет на сервере');
      await mod.muteMember(guild, member, ms, { moderatorId: botId, reason: `Автомодерация: ${reason}` });
      note = `мут на ${Math.round(ms / MINUTE)} мин`;
    } catch (err) {
      logger.warn(`Automod mute failed in ${guild.id}: ${err.message}`);
      await recordAndAnnounce(guild, { userId: author.id, moderatorId: botId, action: 'automod', reason });
    }
  } else {
    await recordAndAnnounce(guild, { userId: author.id, moderatorId: botId, action: 'automod', reason });
  }

  // A short notice in the channel, which removes itself.
  const sent = await message.channel
    .send(`⚠️ <@${author.id}>, сообщение удалено: ${reason}${note ? `. Выдано: ${note}` : ''}.`)
    .catch(() => null);
  const timer = setTimeout(() => sent?.delete?.().catch(() => {}), 7000);
  timer.unref?.();
}

module.exports = { evaluateMessage, handleViolation, logModAction };
