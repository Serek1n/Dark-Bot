// Automod: rules that look at a message, and what happens to the offender (delete / warn / mute).
const { ModLog } = require('../../db');
const mod = require('./moderation');
const { recordAndAnnounce } = require('../utils/modlog');
const { MINUTE, MAX_TIMEOUT } = require('../utils/duration');
const logger = require('../utils/logger');
const { containsProfanity, isZalgo } = require('../utils/profanity');

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

// Lists from the settings are parsed once per distinct text (every message would otherwise parse them again).
const parsedLists = new Map();
const json = (text) => {
  const key = text || '[]';
  const hit = parsedLists.get(key);
  if (hit) return hit;
  let v;
  try {
    v = JSON.parse(key);
    v = Array.isArray(v) ? v : [];
  } catch {
    v = [];
  }
  if (parsedLists.size > 500) parsedLists.clear();
  parsedLists.set(key, v);
  return v;
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

// The rules in the order they are checked. Each can have its own punishment and its own exceptions (settings.automodRules).
const FILTERS = [
  { key: 'words', title: 'Свои запрещённые слова', reason: 'запрещённое слово', test: (s, c) => checkBannedWords(s, c) },
  { key: 'profanity', title: 'Мат', reason: 'нецензурная лексика', test: (s, c) => Boolean(s.automodProfanity) && containsProfanity(c) },
  { key: 'zalgo', title: 'Zalgo-текст', reason: 'Zalgo-текст (символы друг на друге)', test: (s, c) => Boolean(s.automodZalgo) && isZalgo(c) },
  { key: 'invites', title: 'Приглашения на другие серверы', reason: 'ссылка-приглашение на другой сервер', test: (s, c) => checkInvite(s, c) },
  { key: 'links', title: 'Все ссылки', reason: 'ссылки здесь запрещены', test: (s, c) => checkLinks(s, c) },
  { key: 'mentions', title: 'Много упоминаний', reason: 'слишком много упоминаний', test: (s, c) => checkMentions(s, c) },
  { key: 'caps', title: 'КАПС', reason: 'слишком много заглавных букв', test: (s, c) => checkCaps(s, c) },
  { key: 'emoji', title: 'Много эмодзи', reason: 'слишком много эмодзи', test: (s, c) => checkEmoji(s, c) },
  { key: 'duplicates', title: 'Повтор одного и того же', reason: 'повторяющиеся сообщения', test: (s, c, m) => checkDuplicates(s, m.guildId, m.author.id, c) },
  { key: 'spam', title: 'Слишком частые сообщения', reason: 'спам (слишком много сообщений подряд)', test: (s, c, m) => checkSpam(s, m.guildId, m.author.id) }
];
const ACTIONS = ['delete', 'warn', 'mute'];

// Per-rule settings: { words: { action: 'warn', mute: 30, ch: [...], roles: [...] }, ... } (parsed once per distinct text)
const parsedRules = new Map();
function rulesOf(settings) {
  const key = settings.automodRules || '{}';
  let v = parsedRules.get(key);
  if (!v) {
    try { v = JSON.parse(key); } catch { v = {}; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) v = {};
    if (parsedRules.size > 500) parsedRules.clear();
    parsedRules.set(key, v);
  }
  return v;
}

/** A rule's own exceptions: channels where it is off, roles it does not apply to. */
function skipsRule(rule, message) {
  if (!rule) return false;
  if (Array.isArray(rule.ch) && rule.ch.includes(message.channelId)) return true;
  const roles = message.member?.roles?.cache;
  return Boolean(Array.isArray(rule.roles) && rule.roles.length && roles && rule.roles.some((id) => roles.has(id)));
}

/** Runs automod on a message: { key, reason } of the first rule it breaks, or null. */
async function evaluate(settings, message) {
  if (!settings.automodEnabled) return null;
  if (isExempt(settings, message)) return null;
  const content = message.content || '';
  const rules = rulesOf(settings);
  for (const f of FILTERS) {
    if (skipsRule(rules[f.key], message)) continue;
    if (f.test(settings, content, message)) return { key: f.key, reason: f.reason };
  }
  return null;
}

/** The same, only the reason text (or null). */
async function evaluateMessage(settings, message) {
  return (await evaluate(settings, message))?.reason || null;
}

/** What to do for this rule: its own punishment, or the common one. */
function punishmentFor(settings, key) {
  const rule = key ? rulesOf(settings)[key] : null;
  const action = ACTIONS.includes(rule?.action) ? rule.action : ACTIONS.includes(settings.automodAction) ? settings.automodAction : 'delete';
  const minutes = Number(rule?.mute) > 0 ? Number(rule.mute) : Number(settings.automodMuteMinutes) || 10;
  return { action, minutes };
}

// ---------- names ----------
const HOIST = /^[^\p{L}\p{N}]+/u; // "!!!Вася", ".Петя" — to sit on top of the member list

/** The name a member should get instead of a bad one, or null when the name is fine. Pure: no Discord calls. */
function nameVerdict(settings, member) {
  if (!settings?.automodEnabled || (!settings.automodNicknames && !settings.automodDehoist)) return null;
  if (!member || member.user?.bot) return null;
  if (member.permissions?.has?.('ManageNicknames')) return null;
  const ignored = json(settings.automodIgnoredRoles);
  if (ignored.length && member.roles?.cache && ignored.some((id) => member.roles.cache.has(id))) return null;
  const name = String(member.displayName || member.nickname || member.user?.globalName || member.user?.username || '');
  if (!name) return null;
  const replacement = String(settings.automodNickReplacement || 'Ник скрыт').slice(0, 32);
  if (settings.automodNicknames) {
    const bad = checkBannedWords(settings, name) || (settings.automodProfanity && containsProfanity(name)) || isZalgo(name) || INVITE_REGEX.test(name);
    if (bad && name !== replacement) return { nick: replacement, reason: 'недопустимый ник', log: true };
  }
  if (settings.automodDehoist && HOIST.test(name)) {
    const clean = name.replace(HOIST, '').trim().slice(0, 32);
    return { nick: clean || replacement, reason: 'ник со знаками в начале (чтобы быть выше в списке)', log: false };
  }
  return null;
}

/** Checks a member's name and fixes it when needed. Never throws. */
async function checkMemberName(member, settings) {
  try {
    const verdict = nameVerdict(settings, member);
    if (!verdict || member.manageable === false) return null;
    if (verdict.nick === member.nickname) return null;
    await member.setNickname(verdict.nick, `Автомодерация: ${verdict.reason}`);
    if (verdict.log) await recordAndAnnounce(member.guild, { userId: member.id, moderatorId: member.client?.user?.id || '0', action: 'automod', reason: `${verdict.reason}: «${String(member.displayName || '').slice(0, 64)}»` }).catch(() => {});
    return verdict;
  } catch (err) {
    logger.warn(`Automod name check: ${err.message}`);
    return null;
  }
}

async function logModAction(guildId, userId, moderatorId, action, reason) {
  return ModLog.create({ guildId, userId, moderatorId, action, reason });
}

/**
 * What happens after a rule was broken: the message is deleted, then (by the server's choice)
 * the author is only noted, warned (which can escalate by the warning thresholds) or muted.
 */
async function handleViolation(settings, message, reason, ruleKey = null) {
  const guild = message.guild;
  const author = message.author;
  const botId = message.client.user.id;
  await message.delete().catch(() => {});

  const { action, minutes } = punishmentFor(settings, ruleKey);
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
    const ms = Math.min(Math.max(minutes, 1) * MINUTE, MAX_TIMEOUT);
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

module.exports = { evaluate, evaluateMessage, handleViolation, logModAction, punishmentFor, nameVerdict, checkMemberName, FILTERS, ACTIONS };
