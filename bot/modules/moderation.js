// The moderation core, shared by /mod, the automod and the web panel: warnings with automatic
// escalation, temporary bans that lift themselves, DMs to the punished member.
const { Op } = require('sequelize');
const { getOrCreateSettings } = require('./leveling');
const { Warning, ModLog, GuildSettings } = require('../../db');
const { recordAndAnnounce } = require('../utils/modlog');
const { formatDuration, MAX_TIMEOUT, MINUTE } = require('../utils/duration');
const { withLock } = require('../utils/lock');
const logger = require('../utils/logger');
const { createScheduler } = require('../utils/scheduler');

const ESCALATION_ACTIONS = ['mute', 'kick', 'ban'];
const MAX_THRESHOLDS = 10;

/** [{ count, action, minutes }] from the settings JSON: only valid rows, sorted by count. */
function parseThresholds(json) {
  let list = [];
  try {
    list = JSON.parse(json || '[]');
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({ count: Math.floor(Number(t?.count)), action: String(t?.action), minutes: Math.floor(Number(t?.minutes)) || 0 }))
    .filter((t) => t.count >= 1 && t.count <= 100 && ESCALATION_ACTIONS.includes(t.action))
    .sort((a, b) => a.count - b.count)
    .slice(0, MAX_THRESHOLDS);
}

/** Warnings that still count: an optional expiry (days) hides the old ones. */
function activeWarningsWhere(guildId, userId, settings) {
  const where = { guildId, userId };
  const days = Number(settings?.modWarnExpireDays) || 0;
  if (days > 0) where.createdAt = { [Op.gte]: new Date(Date.now() - days * 86400000) };
  return where;
}

async function activeWarnings(guildId, userId, settings) {
  return Warning.findAll({ where: activeWarningsWhere(guildId, userId, settings), order: [['createdAt', 'DESC']] });
}

/** Tells the member about the punishment (closed DMs are ignored). */
async function dmMember(guild, userId, text, settings) {
  if (settings && settings.modDmEnabled === false) return false;
  try {
    await guild.client.users.send(userId, `${text}\n— сервер **${guild.name}**`);
    return true;
  } catch {
    return false;
  }
}

async function loadSettings(guildId) {
  return getOrCreateSettings(guildId);
}

/** Timeout ("mute"). Returns the case, or throws an Error with a readable message. */
async function muteMember(guild, member, ms, { moderatorId, reason, settings }) {
  if (!ms || ms < 1000) throw new Error('Срок мута должен быть больше нуля.');
  if (ms > MAX_TIMEOUT) throw new Error('Мут не может быть дольше 28 дней (ограничение Discord).');
  if (!member.moderatable) throw new Error('Не могу замутить этого участника (его роль выше моей).');
  await member.timeout(ms, reason);
  const entry = await recordAndAnnounce(guild, { userId: member.id, moderatorId, action: 'mute', reason, duration: ms });
  await dmMember(guild, member.id, `🔇 Вы получили мут на ${formatDuration(ms)}: ${reason}`, settings ?? (await loadSettings(guild.id)));
  return entry;
}

async function kickMember(guild, member, { moderatorId, reason, settings }) {
  if (!member.kickable) throw new Error('Не могу кикнуть этого участника.');
  // DM first: after the kick there is no common server any more.
  await dmMember(guild, member.id, `👢 Вы были выгнаны: ${reason}`, settings ?? (await loadSettings(guild.id)));
  await member.kick(reason);
  return recordAndAnnounce(guild, { userId: member.id, moderatorId, action: 'kick', reason });
}

/** Ban, permanent or for `ms` milliseconds (the scheduler lifts it). */
async function banUser(guild, userId, { moderatorId, reason, ms = null, deleteSeconds = 0, settings }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member && !member.bannable) throw new Error('Не могу забанить этого участника.');
  const until = ms ? `на ${formatDuration(ms)}` : 'навсегда';
  if (member) await dmMember(guild, userId, `🔨 Вы забанены ${until}: ${reason}`, settings ?? (await loadSettings(guild.id)));
  await guild.members.ban(userId, { reason, deleteMessageSeconds: deleteSeconds });
  // A new ban replaces an older temporary one.
  await ModLog.update({ active: false }, { where: { guildId: guild.id, userId, action: 'ban', active: true } });
  return recordAndAnnounce(guild, {
    userId,
    moderatorId,
    action: 'ban',
    reason,
    duration: ms,
    expiresAt: ms ? new Date(Date.now() + ms) : null,
    active: Boolean(ms)
  });
}

async function unbanUser(guild, userId, { moderatorId, reason }) {
  await guild.members.unban(userId);
  await ModLog.update({ active: false }, { where: { guildId: guild.id, userId, action: 'ban', active: true } });
  return recordAndAnnounce(guild, { userId, moderatorId, action: 'unban', reason });
}

/**
 * Gives a warning and runs the escalation rule for the new number of active warnings
 * (e.g. "3 warnings -> mute 1 hour"). Returns { warning, count, entry, escalation }.
 */
async function warnMember(guild, user, { moderatorId, reason, settings }) {
  settings = settings ?? (await loadSettings(guild.id));
  // Under a lock, so two simultaneous warnings can't both skip (or both trigger) the same threshold.
  const { warning, count } = await withLock(`warn:${guild.id}:${user.id}`, async () => {
    const created = await Warning.create({ guildId: guild.id, userId: user.id, moderatorId, reason });
    return { warning: created, count: (await activeWarnings(guild.id, user.id, settings)).length };
  });
  const entry = await recordAndAnnounce(guild, { userId: user.id, moderatorId, action: 'warn', reason });
  await dmMember(guild, user.id, `⚠️ Вы получили предупреждение (${count}): ${reason}`, settings);

  const rule = parseThresholds(settings?.modWarnThresholds).find((t) => t.count === count);
  let escalation = null;
  if (rule) escalation = await escalate(guild, user.id, rule, count, settings);
  return { warning, count, entry, escalation };
}

async function escalate(guild, userId, rule, count, settings) {
  const botId = guild.client.user.id;
  const reason = `Автоматически: ${count} предупреждений`;
  try {
    if (rule.action === 'ban') {
      const ms = rule.minutes > 0 ? rule.minutes * MINUTE : null;
      const entry = await banUser(guild, userId, { moderatorId: botId, reason, ms, settings });
      return { action: 'ban', ms, entry };
    }
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { action: rule.action, error: 'участника нет на сервере' };
    if (rule.action === 'kick') return { action: 'kick', entry: await kickMember(guild, member, { moderatorId: botId, reason, settings }) };
    const ms = Math.min(Math.max(rule.minutes, 1) * MINUTE, MAX_TIMEOUT);
    return { action: 'mute', ms, entry: await muteMember(guild, member, ms, { moderatorId: botId, reason, settings }) };
  } catch (err) {
    logger.warn(`Warn escalation (${rule.action}) failed in guild ${guild.id}: ${err.message}`);
    return { action: rule.action, error: err.message };
  }
}

/** Lifts the temporary bans that have run out. Returns how many were lifted. */
async function liftExpiredBans(client) {
  const due = await ModLog.findAll({ where: { action: 'ban', active: true, expiresAt: { [Op.lte]: new Date() } }, limit: 50 });
  let lifted = 0;
  for (const entry of due) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue; // the bot is not on that server right now; try again later
    try {
      await guild.members.unban(entry.userId, `Срок бана истёк (дело #${entry.caseNumber})`).catch((err) => {
        if (!/unknown ban|10026/i.test(String(err.message) + String(err.code))) throw err; // already unbanned by hand: fine
      });
      await entry.update({ active: false });
      await recordAndAnnounce(guild, { userId: entry.userId, moderatorId: client.user.id, action: 'unban', reason: `Срок бана истёк (дело #${entry.caseNumber})` });
      lifted++;
    } catch (err) {
      logger.warn(`Could not lift the ban of ${entry.userId} in ${entry.guildId}: ${err.message}`);
      await entry.update({ expiresAt: new Date(Date.now() + 5 * MINUTE) }).catch(() => {}); // do not retry every tick
    }
  }
  return lifted;
}

let scheduler = null;
function startModScheduler(client) {
  if (scheduler) return;
  scheduler = createScheduler({
    name: 'mod',
    nextDue: () => ModLog.min('expiresAt', { where: { action: 'ban', active: true } }),
    run: () => liftExpiredBans(client)
  }).start();
}

module.exports = {
  parseThresholds, activeWarnings, activeWarningsWhere, dmMember, muteMember, kickMember, banUser, unbanUser,
  warnMember, escalate, liftExpiredBans, startModScheduler, ESCALATION_ACTIONS, MAX_THRESHOLDS
};
