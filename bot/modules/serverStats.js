// «Статистика сервера»: the numbers of a server by day (members, who came and left, messages, minutes in voice, the most
// people online and in voice at once) and counters in the names of channels («👥 Участники: 1 234»).
//
// Counting: messages, joins and leaves are added up in memory and written to guild_stat_days once a minute (one
// transaction for all servers); every minute the people sitting in voice are counted from the cache.
// Counters: Discord lets a channel be renamed twice in ten minutes, so a channel is renamed at most once in ten minutes
// and only when its name really changes. A channel that was deleted leaves the list; a channel the bot may not rename
// keeps its place and the panel shows why.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

const TZ = process.env.STATS_TZ || 'Europe/Moscow';
const MAX_COUNTERS = 10;
const RENAME_EVERY_MS = 10 * 60 * 1000;
const NAME_MAX = 100;

const db = () => require('../../db');
const isOn = (settings) => require('../utils/features').isEnabled(settings, 'serverStats');

/** Today in the server's statistics zone: YYYY-MM-DD. */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); // made once: asked on every message
const dayKey = (d = new Date()) => DAY_FMT.format(d);

// ---- the values a counter can show ----
const VARS = [
  ['members', 'все участники', '👥 Участники: {members}'],
  ['humans', 'люди (без ботов)', '🙂 Люди: {humans}'],
  ['bots', 'боты', '🤖 Боты: {bots}'],
  ['online', 'в сети сейчас', '🟢 В сети: {online}'],
  ['voice', 'в голосовых сейчас', '🎙️ В голосе: {voice}'],
  ['boosts', 'бусты', '🚀 Бусты: {boosts}'],
  ['tier', 'уровень бустов', null],
  ['joins_today', 'пришли сегодня', '📥 Новых сегодня: {joins_today}'],
  ['leaves_today', 'ушли сегодня', '📤 Ушли сегодня: {leaves_today}'],
  ['messages_today', 'сообщений сегодня', '💬 Сообщений сегодня: {messages_today}'],
  ['channels', 'каналов', '#️⃣ Каналы: {channels}'],
  ['roles', 'ролей', '🏷️ Роли: {roles}'],
  ['emojis', 'эмодзи', null],
  ['date', 'сегодняшняя дата', '📅 {date}']
];
const VAR_NAMES = VARS.map((v) => v[0]);

// ---- counting by day (in memory, then written once a minute) ----
const pending = new Map(); // guildId -> { day, joins, leaves, messages, voiceMinutes, voicePeak, onlinePeak, members }
const enabledCache = new Map(); // guildId -> { at, on }

function bucket(guildId) {
  const day = dayKey();
  let b = pending.get(guildId);
  if (!b || b.day !== day) {
    if (b && b.day !== day) { const old = b; db().inTransaction((t) => flushOne(guildId, old, t)).catch(() => {}); } // yesterday's rest goes to its own day
    b = { day, joins: 0, leaves: 0, messages: 0, voiceMinutes: 0, voicePeak: 0, onlinePeak: 0, members: null };
    pending.set(guildId, b);
  }
  return b;
}

/** Is the module on for this server (the flag is read at most once a minute)? */
async function counting(guildId) {
  const hit = enabledCache.get(guildId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  const s = await db().GuildSettings.findOne({ where: { guildId }, attributes: ['guildId', 'serverStatsEnabled'] }).catch(() => null);
  const on = s ? s.serverStatsEnabled !== false : true;
  enabledCache.set(guildId, { at: Date.now(), on });
  return on;
}
const forget = (guildId) => enabledCache.delete(guildId);

function onMessage(message) {
  if (!message.guild || message.author?.bot) return;
  bucket(message.guild.id).messages += 1;
}
function onJoin(member) {
  if (member.user?.bot) return;
  const b = bucket(member.guild.id); b.joins += 1; b.members = member.guild.memberCount;
  wake(member.guild);
}
function onLeave(member) {
  if (member.user?.bot) return;
  const b = bucket(member.guild.id); b.leaves += 1; b.members = member.guild.memberCount;
  wake(member.guild);
}

/** People in voice right now: not bots, not in the AFK channel. */
function inVoice(guild) {
  let n = 0;
  for (const ch of guild.channels?.cache?.values?.() || []) {
    if (!ch.isVoiceBased?.() || ch.id === guild.afkChannelId) continue;
    for (const m of ch.members?.values?.() || []) if (!m.user?.bot) n += 1;
  }
  return n;
}

/** Every minute: the minutes in voice and the peak; the members count. */
function sampleVoice(client) {
  for (const guild of client.guilds.cache.values()) {
    const n = inVoice(guild);
    const b = bucket(guild.id);
    b.voiceMinutes += n;
    if (n > b.voicePeak) b.voicePeak = n;
    b.members = guild.memberCount;
  }
}

async function flushOne(guildId, b, t = null) {
  const { GuildStatDay } = db();
  const [row] = await GuildStatDay.findOrCreate({ where: { guildId, day: b.day }, defaults: { guildId, day: b.day }, transaction: t });
  const add = { joins: b.joins, leaves: b.leaves, messages: b.messages, voiceMinutes: b.voiceMinutes };
  const set = {};
  if (b.members !== null && b.members !== undefined) set.members = b.members;
  if (b.voicePeak > (row.voicePeak || 0)) set.voicePeak = b.voicePeak;
  if (b.onlinePeak > (row.onlinePeak || 0)) set.onlinePeak = b.onlinePeak;
  if (Object.values(add).some((v) => v > 0)) await row.increment(add, { transaction: t });
  if (Object.keys(set).length) await row.update(set, { transaction: t });
}

/** Writes what was counted. The counts are taken out first, so what comes in meanwhile waits for the next minute. */
async function flushAll() {
  const items = [];
  for (const [guildId, b] of pending) {
    if (!b.joins && !b.leaves && !b.messages && !b.voiceMinutes && !b.voicePeak && !b.onlinePeak && b.members === null) continue;
    if (!(await counting(guildId))) { pending.delete(guildId); continue; }
    items.push([guildId, { ...b }]);
    b.joins = 0; b.leaves = 0; b.messages = 0; b.voiceMinutes = 0; // peaks stay: they are compared with the saved ones
  }
  if (!items.length) return;
  try {
    await db().inTransaction(async (t) => { for (const [g, b] of items) await flushOne(g, b, t); });
  } catch (err) {
    // put the counts back: nothing is lost because the database was busy once
    for (const [g, b] of items) { const cur = bucket(g); if (cur.day === b.day) { cur.joins += b.joins; cur.leaves += b.leaves; cur.messages += b.messages; cur.voiceMinutes += b.voiceMinutes; } }
    logger.warn(`server stats: ${err.message}`);
  }
}

// ---- reading ----
/** The days of the last `days` days (today included), every day present (zeros where nothing was counted). */
async function history(guildId, days = 30) {
  const { GuildStatDay } = db();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(Date.now() - i * 86400000)));
  const rows = await GuildStatDay.findAll({ where: { guildId, day: keys }, raw: true });
  const by = new Map(rows.map((r) => [r.day, r]));
  const live = pending.get(guildId);
  return keys.map((day) => {
    const r = by.get(day) || { day, members: 0, joins: 0, leaves: 0, messages: 0, voiceMinutes: 0, voicePeak: 0, onlinePeak: 0 };
    const out = { day, members: r.members || null, joins: r.joins || 0, leaves: r.leaves || 0, messages: r.messages || 0, voiceMinutes: r.voiceMinutes || 0, voicePeak: r.voicePeak || 0, onlinePeak: r.onlinePeak || 0 };
    if (live && live.day === day) { // what is still in memory
      out.joins += live.joins; out.leaves += live.leaves; out.messages += live.messages; out.voiceMinutes += live.voiceMinutes;
      out.voicePeak = Math.max(out.voicePeak, live.voicePeak); out.onlinePeak = Math.max(out.onlinePeak, live.onlinePeak);
      if (live.members !== null) out.members = live.members;
    }
    return out;
  });
}

// ---- the values right now ----
const bulkFetchAt = new Map(); // guildId -> last full member fetch (for humans / bots)
async function memberSplit(guild) {
  const cache = guild.members.cache;
  if (cache.size < guild.memberCount * 0.98 && guild.memberCount <= 25000) {
    const last = bulkFetchAt.get(guild.id) || 0;
    if (Date.now() - last > 6 * 60 * 60 * 1000) {
      bulkFetchAt.set(guild.id, Date.now());
      await guild.members.fetch({ time: 120000 }).catch((err) => logger.warn(`server stats members ${guild.id}: ${err.message}`));
    }
  }
  const bots = guild.members.cache.filter((m) => m.user?.bot).size;
  const complete = guild.members.cache.size >= guild.memberCount * 0.98;
  return { bots, humans: Math.max(0, guild.memberCount - bots), exact: complete };
}

async function onlineNow(guild) {
  const fresh = await guild.client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => null);
  const n = fresh?.approximatePresenceCount ?? null;
  if (n !== null) { const b = bucket(guild.id); if (n > b.onlinePeak) b.onlinePeak = n; }
  return n;
}

const fmtNum = (n) => (n === null || n === undefined ? '—' : Math.trunc(Number(n)).toLocaleString('ru-RU').replace(/\u00a0/g, ' '));
const fmtDate = (d = new Date()) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d);

/** The values the given templates need (only those: «online» asks Discord, «humans» may load the members). */
async function values(guild, templates = null) {
  const need = (k) => !templates || templates.some((t) => t.includes(`{${k}}`));
  const today = need('joins_today') || need('leaves_today') || need('messages_today') ? (await history(guild.id, 1))[0] : null;
  const split = need('humans') || need('bots') ? await memberSplit(guild) : null;
  return {
    members: guild.memberCount,
    humans: split?.humans ?? null,
    bots: split?.bots ?? null,
    online: need('online') ? await onlineNow(guild) : null,
    voice: inVoice(guild),
    boosts: guild.premiumSubscriptionCount || 0,
    tier: guild.premiumTier || 0,
    joins_today: today?.joins ?? 0,
    leaves_today: today?.leaves ?? 0,
    messages_today: today?.messages ?? 0,
    channels: guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size,
    roles: Math.max(0, guild.roles.cache.size - 1),
    emojis: guild.emojis?.cache?.size || 0,
    date: fmtDate()
  };
}

/** A counter's name: the template with its {values}; at most 100 characters. */
function renderName(template, v) {
  let out = String(template || '');
  for (const k of VAR_NAMES) out = out.split(`{${k}}`).join(k === 'date' ? v.date : fmtNum(v[k]));
  return out.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || '—';
}

// ---- the counters' settings ----
function read(settings) {
  let raw = {};
  try { raw = JSON.parse(settings?.serverStats || '{}') || {}; } catch { raw = {}; }
  const counters = (Array.isArray(raw.counters) ? raw.counters : [])
    .filter((c) => c && /^\d{15,25}$/.test(String(c.channelId || '')))
    .slice(0, MAX_COUNTERS)
    .map((c) => ({ channelId: String(c.channelId), template: String(c.template || '').replace(/[\r\n]+/g, ' ').slice(0, NAME_MAX) || '{members}' }));
  return { counters, categoryId: /^\d{15,25}$/.test(String(raw.categoryId || '')) ? String(raw.categoryId) : null };
}
const write = (settings, cfg) => { settings.serverStats = JSON.stringify({ counters: cfg.counters, categoryId: cfg.categoryId || null }); };

// ---- renaming ----
const lastRename = new Map(); // channelId -> time
const problems = new Map(); // channelId -> the reason it was not renamed (for the panel)
const busy = new Set();

/** Renames this server's counters whose names changed (each at most once in ten minutes). `force` ignores the pause once. */
async function refreshGuild(guild, { force = false } = {}) {
  if (!guild || busy.has(guild.id)) return { renamed: 0 };
  busy.add(guild.id);
  let renamed = 0;
  try {
    const settings = await db().GuildSettings.findOne({ where: { guildId: guild.id } });
    if (!settings || !isOn(settings)) return { renamed };
    const cfg = read(settings);
    if (!cfg.counters.length) return { renamed };
    const v = await values(guild, cfg.counters.map((c) => c.template));
    let changed = false;
    for (const c of [...cfg.counters]) {
      let ch = guild.channels.cache.get(c.channelId);
      if (!ch) ch = await guild.channels.fetch(c.channelId).catch((err) => (require('../utils/discordErrors').isGone(err) ? false : null));
      if (ch === false) { cfg.counters = cfg.counters.filter((x) => x !== c); changed = true; problems.delete(c.channelId); continue; } // deleted
      if (!ch) continue; // Discord did not answer: next time
      const name = renderName(c.template, v);
      if (ch.name === name) { problems.delete(c.channelId); continue; }
      const last = lastRename.get(ch.id) || 0;
      if (!force && Date.now() - last < RENAME_EVERY_MS) continue;
      if (force && Date.now() - last < 60_000) continue; // even a forced one: not twice a minute
      const me = guild.members.me;
      if (me && !ch.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) { problems.set(ch.id, 'Нет права «Управлять каналами» в этом канале'); continue; }
      lastRename.set(ch.id, Date.now());
      await ch.setName(name, 'Статистика сервера').then(() => { renamed += 1; problems.delete(ch.id); }).catch((err) => {
        problems.set(ch.id, err.status === 429 ? 'Discord просит подождать: название обновится позже' : `Discord не дал переименовать: ${err.message}`);
      });
    }
    if (changed) { write(settings, cfg); await settings.save().catch(() => {}); }
  } catch (err) {
    logger.warn(`server stats ${guild.id}: ${err.message}`);
  } finally {
    busy.delete(guild.id);
  }
  return { renamed };
}

// A join or a leave changes {members}: the counters are looked at again soon (still at most once in ten minutes).
const soon = new Map();
function wake(guild) {
  if (soon.has(guild.id)) return;
  soon.set(guild.id, setTimeout(() => { soon.delete(guild.id); refreshGuild(guild).catch(() => {}); }, 30_000).unref?.() || true);
}

/**
 * Makes a counter: a voice channel nobody can join (only see), in the chosen category or a new «📊 Статистика» at the top.
 * Returns { ok, channel } or { ok: false, error }.
 */
async function createCounter(guild, settings, template) {
  const cfg = read(settings);
  if (cfg.counters.length >= MAX_COUNTERS) return { ok: false, code: 'max', error: `Не больше ${MAX_COUNTERS} счётчиков на сервер.` };
  const me = guild.members.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) return { ok: false, code: 'perm', error: 'У бота нет права «Управлять каналами».' };
  let category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
  try {
    if (!category) {
      category = await guild.channels.create({ name: '📊 Статистика', type: ChannelType.GuildCategory, position: 0, reason: 'Статистика сервера' });
      cfg.categoryId = category.id;
    }
    const v = await values(guild, [template]);
    const channel = await guild.channels.create({
      name: renderName(template, v), type: ChannelType.GuildVoice, parent: category.id, reason: 'Статистика сервера: счётчик',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect], allow: [PermissionFlagsBits.ViewChannel] },
        ...(me ? [{ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect] }] : [])
      ]
    });
    lastRename.set(channel.id, Date.now());
    cfg.counters.push({ channelId: channel.id, template });
    write(settings, cfg);
    await settings.save();
    return { ok: true, channel };
  } catch (err) {
    if (category && cfg.categoryId === category.id && !read(settings).categoryId) { write(settings, { counters: read(settings).counters, categoryId: category.id }); await settings.save().catch(() => {}); } // the new category is kept for next time
    return { ok: false, code: 'discord', error: `Discord не дал создать канал: ${err.message}` };
  }
}

/** Removes a counter; `deleteChannel` also deletes the channel itself. */
async function removeCounter(guild, settings, channelId, deleteChannel = true) {
  const cfg = read(settings);
  cfg.counters = cfg.counters.filter((c) => c.channelId !== channelId);
  write(settings, cfg);
  await settings.save();
  problems.delete(channelId);
  if (deleteChannel && guild) {
    const ch = guild.channels.cache.get(channelId);
    if (ch) await ch.delete('Статистика сервера: счётчик убран').catch(() => {});
  }
}

/** Only the servers that have counters are looked at (one query, not one per server). */
async function refreshAll(client) {
  const { Op } = require('sequelize');
  const rows = await db().GuildSettings.findAll({ where: { serverStats: { [Op.ne]: null } }, attributes: ['guildId', 'serverStats'], raw: true });
  for (const r of rows) {
    if (!read(r).counters.length) continue;
    const guild = client.guilds.cache.get(r.guildId);
    if (guild) await refreshGuild(guild).catch(() => {});
  }
}

// ---- start ----
let timers = [];
function startServerStats(client) {
  timers.forEach(clearInterval);
  timers = [
    setInterval(() => { sampleVoice(client); flushAll().catch(() => {}); }, 60_000),
    setInterval(() => refreshAll(client).catch(() => {}), RENAME_EVERY_MS + 5_000)
  ];
  timers.forEach((t) => t.unref?.());
  setTimeout(() => refreshAll(client).catch(() => {}), 20_000).unref?.();
}
const stopServerStats = () => { timers.forEach(clearInterval); timers = []; return flushAll(); };

module.exports = {
  VARS, VAR_NAMES, MAX_COUNTERS, TZ, dayKey, onMessage, onJoin, onLeave, sampleVoice, flushAll, history, values, renderName, inVoice,
  read, write, refreshGuild, refreshAll, createCounter, removeCounter, problems, startServerStats, stopServerStats, forget, counting, onlineNow, memberSplit, fmtNum
};
