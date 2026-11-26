// The moderation core, shared by /mod, the automod and the web panel: warnings with automatic
// escalation, temporary bans that lift themselves, DMs to the punished member.
const { Op } = require('sequelize');
const { PermissionFlagsBits } = require('discord.js');
const { getOrCreateSettings } = require('./leveling');
const { Warning, ModLog } = require('../../db');
const { recordAndAnnounce } = require('../utils/modlog');
const { formatDuration, MAX_TIMEOUT, MINUTE } = require('../utils/duration');
const { withLock } = require('../utils/lock');
const logger = require('../utils/logger');
const { createScheduler } = require('../utils/scheduler');
const { whyCannot, apiErrorText } = require('../utils/punishable');

/** An Error whose message is shown to the moderator as is. */
const refusal = (text) => Object.assign(new Error(text), { refusal: true });
/** Calls Discord; a failure becomes a readable refusal with the API's real reason. */
async function callDiscord(fn, action) {
  try { return await fn(); } catch (err) { throw refusal(apiErrorText(err, action)); }
}

const ESCALATION_ACTIONS = ['mute', 'kick', 'ban']; // the older thresholds by count; the ladder (modConfig) has more
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
  // a warning with its own end (points that burn out) counts until then; the older general rule hides old ones too
  const where = { guildId, userId, revokedAt: null, [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] };
  const days = Number(settings?.modWarnExpireDays) || 0;
  if (days > 0) where.createdAt = { [Op.gte]: new Date(Date.now() - days * 86400000) };
  return where;
}
const modCfg = (settings) => require('../utils/moduleConfig').read(settings, 'mod');
/** The sum of the points of a member's active warnings. */
const pointsOf = (warnings) => warnings.reduce((n, w) => n + (Number(w.points) || 1), 0);

async function activeWarnings(guildId, userId, settings) {
  return Warning.findAll({ where: activeWarningsWhere(guildId, userId, settings), order: [['createdAt', 'DESC']] });
}

/** Tells the member about the punishment (closed DMs are ignored). */
async function dmMember(guild, userId, text, settings) {
  if (settings && settings.modDmEnabled === false) return false;
  try {
    return (await guild.client.users.send(userId, `${text}\n— сервер **${guild.name}**`)) || true; // the message, to take it back if the punishment fails
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
  const why = whyCannot(guild, member, 'mute');
  if (why) throw refusal(why);
  await callDiscord(() => member.timeout(ms, reason), 'mute');
  const entry = await recordAndAnnounce(guild, { userId: member.id, moderatorId, action: 'mute', reason, duration: ms });
  settings = settings ?? (await loadSettings(guild.id));
  const ap = require('./appeals');
  await ap.afterPunishmentDm(guild.id, entry, await ap.punishmentDm(guild, member.id, `🔇 Вы получили мут на ${formatDuration(ms)}: ${reason}`, settings, 'mute'));
  return entry;
}

async function kickMember(guild, member, { moderatorId, reason, settings }) {
  const why = whyCannot(guild, member, 'kick');
  if (why) throw refusal(why);
  // DM first: after the kick there is no common server any more. If the kick then fails, the DM is taken back.
  const dm = await dmMember(guild, member.id, `👢 Вы были выгнаны: ${reason}`, settings ?? (await loadSettings(guild.id)));
  await callDiscord(() => member.kick(reason), 'kick').catch(async (err) => { await dm?.delete?.().catch(() => {}); throw err; });
  return recordAndAnnounce(guild, { userId: member.id, moderatorId, action: 'kick', reason });
}

/** Ban, permanent or for `ms` milliseconds (the scheduler lifts it). */
async function banUser(guild, userId, { moderatorId, reason, ms = null, deleteSeconds = 0, settings }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const why = member && whyCannot(guild, member, 'ban');
  if (why) throw refusal(why);
  const until = ms ? `на ${formatDuration(ms)}` : 'навсегда';
  settings = settings ?? (await loadSettings(guild.id));
  // The case is written BEFORE the ban: a stop right after the ban can no longer leave a temporary ban with no record (it
  // would never be lifted). If the ban fails, the case and the DM are taken back.
  const { createCase, announceCase } = require('../utils/modlog');
  // the DM goes BEFORE the ban: after it there is no common server and Discord refuses to deliver it
  const ap = require('./appeals');
  const dmr = await ap.punishmentDm(guild, userId, `🔨 Вы забанены ${until}: ${reason}`, settings, 'ban', { reach: Boolean(member) });
  const dm = dmr.message;
  const older = await ModLog.findAll({ where: { guildId: guild.id, userId, action: 'ban', active: true }, attributes: ['id'] });
  const entry = await createCase(guild.id, { userId, moderatorId, action: 'ban', reason: String(reason || 'Без причины').slice(0, 1000), duration: ms, expiresAt: ms ? new Date(Date.now() + ms) : null, active: Boolean(ms) });
  require('./serverLog').markReported(guild.id, userId, 'ban'); // before the ban: its Discord event must not be logged twice
  try {
    await callDiscord(() => guild.members.ban(userId, { reason, deleteMessageSeconds: deleteSeconds }), 'ban');
  } catch (err) {
    await entry.destroy().catch(() => {});
    await dm?.delete?.().catch(() => {});
    throw err;
  }
  // A new ban replaces an older temporary one.
  if (older.length) await ModLog.update({ active: false }, { where: { id: older.map((o) => o.id) } });
  await ap.afterPunishmentDm(guild.id, entry, member ? dmr : { ...dmr, skipped: !dmr.pass });
  return announceCase(guild, entry);
}

async function unbanUser(guild, userId, { moderatorId, reason }) {
  await callDiscord(() => guild.members.unban(userId, reason || undefined), 'ban');
  await ModLog.update({ active: false }, { where: { guildId: guild.id, userId, action: 'ban', active: true } });
  return recordAndAnnounce(guild, { userId, moderatorId, action: 'unban', reason });
}

/**
 * Gives a warning and runs the escalation rule for the new number of active warnings
 * (e.g. "3 warnings -> mute 1 hour"). Returns { warning, count, entry, escalation }.
 */
async function warnMember(guild, user, { moderatorId, reason, settings, points = null }) {
  settings = settings ?? (await loadSettings(guild.id));
  const cfg = modCfg(settings);
  const weight = Math.max(1, Math.min(20, Math.floor(Number(points) || cfg.defaultPoints)));
  const expiresAt = cfg.decayDays ? new Date(Date.now() + cfg.decayDays * 86400000) : null;
  // Under a lock, so two simultaneous warnings can't both skip (or both trigger) the same threshold.
  const { warning, count, total, before } = await withLock(`warn:${guild.id}:${user.id}`, async () => {
    const was = pointsOf(await activeWarnings(guild.id, user.id, settings));
    const created = await Warning.create({ guildId: guild.id, userId: user.id, moderatorId, reason, points: weight, expiresAt });
    const now = await activeWarnings(guild.id, user.id, settings);
    return { warning: created, count: now.length, total: pointsOf(now), before: was };
  });
  const entry = await recordAndAnnounce(guild, { userId: user.id, moderatorId, action: 'warn', reason: weight > 1 ? `${reason} (${weight} балл.)` : reason });
  const pts = cfg.escalateBy === 'points' ? ` · баллов: ${total}` : '';
  const ap = require('./appeals');
  await ap.afterPunishmentDm(guild.id, entry, await ap.punishmentDm(guild, user.id, `⚠️ Вы получили предупреждение (${count}${pts}): ${reason}`, settings, 'warn'));

  // the server's ladder (by count, or by points crossed now); without one, the older thresholds by count
  let rule = null;
  if (cfg.ladder.length) {
    const steps = cfg.ladder.slice().sort((a, b) => a.at - b.at);
    const hit = cfg.escalateBy === 'points' ? steps.filter((st) => before < st.at && total >= st.at) : steps.filter((st) => st.at === count);
    const step = hit[hit.length - 1];
    if (step) rule = { ...step, count: step.at, ladder: true };
  } else {
    const t = parseThresholds(settings?.modWarnThresholds).find((x) => x.count === count);
    if (t) rule = { ...t, action: t.action === 'mute' ? 'timeout' : t.action };
  }
  let escalation = null;
  if (rule) {
    // With "only with the right" on, a moderator cannot get past his own rights through the warning counter (the bot's own warnings, e.g. from automod, always count).
    if (settings?.modEscalateNeedsPerm && moderatorId !== guild.client.user.id && !(await moderatorCan(guild, moderatorId, rule.action))) {
      escalation = { action: rule.action, ms: ruleMs(rule), status: 'skipped', skipped: true, error: 'у модератора нет права на это действие' };
    } else {
      escalation = await escalate(guild, user.id, rule, cfg.escalateBy === 'points' && rule.ladder ? `${total} баллов предупреждений` : `${count} предупреждений`, settings);
    }
    // the real outcome stays with the warning (never "applied" when it was not)
    const { action, ms, status, error, until } = escalation;
    await warning.update({ autoAction: JSON.stringify({ action, ms: ms || null, status, error: error || null, until: until || null, threshold: rule.count, caseNumber: escalation.entry?.caseNumber || null, roleId: rule.roleId || null }) }).catch(() => {});
  }
  return { warning, count, points: total, entry, escalation };
}

const NEEDED_PERMISSION = { mute: PermissionFlagsBits.ModerateMembers, timeout: PermissionFlagsBits.ModerateMembers, kick: PermissionFlagsBits.KickMembers, ban: PermissionFlagsBits.BanMembers, tempban: PermissionFlagsBits.BanMembers,
  role_mute: PermissionFlagsBits.ManageRoles, quarantine: PermissionFlagsBits.ManageRoles, restrict: PermissionFlagsBits.ManageRoles, temprole: PermissionFlagsBits.ManageRoles };

/** Does this person have the server permission that the punishment `action` (mute | kick | ban) needs? */
async function moderatorCan(guild, moderatorId, action) {
  const flag = NEEDED_PERMISSION[action];
  if (!flag) return false;
  if (guild.ownerId === moderatorId) return true;
  const member = await guild.members.fetch(moderatorId).catch(() => null);
  return Boolean(member?.permissions?.has(flag));
}

/** The length of a threshold's punishment: a mute always has one (1 min .. 28 days), a ban may be permanent (null). */
function ruleMs(rule) {
  if (rule.action === 'mute' || rule.action === 'timeout') return Math.min(Math.max(rule.minutes, 1) * MINUTE, MAX_TIMEOUT);
  if (rule.action === 'tempban') return Math.max(rule.minutes, 1) * MINUTE;
  if (rule.action === 'temprole') return Math.max(rule.minutes, 1) * MINUTE;
  if (['ban', 'role_mute', 'quarantine', 'restrict'].includes(rule.action)) return rule.minutes > 0 ? rule.minutes * MINUTE : null;
  return null;
}

/**
 * Runs a threshold's punishment. Always returns { action, ms, status, error?, entry?, until? }:
 * applied · already (a longer mute is already running — not shortened) · failed (with the exact reason).
 */
async function escalate(guild, userId, rule, why, settings) {
  const botId = guild.client.user.id;
  const reason = `Автоматически: ${typeof why === 'number' ? `${why} предупреждений` : why}`;
  const ms = ruleMs(rule);
  const base = { action: rule.action, ms };
  try {
    if (rule.action === 'ban' || rule.action === 'tempban') return { ...base, status: 'applied', entry: await banUser(guild, userId, { moderatorId: botId, reason, ms, settings }) };
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member) return { ...base, status: 'failed', error: 'Участника нет на сервере.' };
    if (rule.action === 'kick') return { ...base, status: 'applied', entry: await kickMember(guild, member, { moderatorId: botId, reason, settings }) };
    if (['role_mute', 'quarantine', 'restrict'].includes(rule.action)) {
      const r = await require('./punishments').apply(guild, member, rule.action, { roleId: rule.roleId, ms, moderatorId: botId, reason, settings });
      return { ...base, status: 'applied', entry: r.entry };
    }
    if (rule.action === 'temprole') {
      const role = rule.roleId && guild.roles.cache.get(rule.roleId);
      if (!role) return { ...base, status: 'failed', error: 'Роль ступени удалена или не выбрана.' };
      const r = await require('./tempRoles').giveWithCase(guild, member, role, ms, { byId: botId, reason });
      return { ...base, status: 'applied', entry: r.entry };
    }
    const running = Number(member.communicationDisabledUntilTimestamp) || 0;
    if (running > Date.now() + ms) return { ...base, status: 'already', until: running };
    return { ...base, status: 'applied', entry: await muteMember(guild, member, ms, { moderatorId: botId, reason, settings }) };
  } catch (err) {
    logger.warn(`Warn escalation (${rule.action}) failed in guild ${guild.id}: ${err.message}`);
    return { ...base, status: 'failed', error: err.message };
  }
}

/** "мут на 1 ч", "бан на 2 д", "бан навсегда", "кик" — never "мут на " without the length. */
function punishmentName(action, ms) {
  const span = ms ? `на ${formatDuration(ms)}` : 'до снятия';
  if (action === 'mute' || action === 'timeout') return `мут на ${formatDuration(ms || MINUTE)}`;
  if (action === 'ban' || action === 'tempban') return ms ? `бан на ${formatDuration(ms)}` : 'бан навсегда';
  if (action === 'kick') return 'кик';
  if (action === 'role_mute') return `мут ролью ${span}`;
  if (action === 'quarantine') return `карантин ${span}`;
  if (action === 'restrict') return `ограничение ${span}`;
  if (action === 'temprole') return `временная роль на ${formatDuration(ms || MINUTE)}`;
  return action;
}

/** One line about an automatic punishment for messages and embeds: { ok, text }. */
function describeEscalation(e) {
  if (!e) return null;
  const what = punishmentName(e.action, e.ms);
  if (e.status === 'applied') return { ok: true, text: `✅ Автоматически: ${what}.` };
  if (e.status === 'already') return { ok: true, text: `ℹ️ ${what[0].toUpperCase()}${what.slice(1)} не понадобился: участник уже в муте до <t:${Math.floor(e.until / 1000)}:f>.` };
  if (e.status === 'skipped') return { ok: false, text: `ℹ️ Порог достигнут, но автоматическое наказание (${what}) не применено: у вас нет права на это действие. Решите вручную через /mod.` };
  return { ok: false, text: `❌ Автоматическое наказание (${what}) не применено. ${e.error || ''}`.trim() };
}

/** Removes a warning but keeps it in the history (who, when, why). Returns false when it was already removed. */
async function revokeWarning(warning, { by, reason, guild = null }) {
  if (warning.revokedAt) return false;
  await warning.update({ revokedAt: new Date(), revokedBy: by, revokeReason: String(reason || '').slice(0, 250) || null });
  if (guild) await revertAuto(guild, warning, by).catch((err) => logger.warn(`Auto-revert failed: ${err.message}`));
  return true;
}

const SOFT = ['timeout', 'mute', 'role_mute', 'quarantine', 'restrict', 'temprole'];
/**
 * «Откат»: a warning given by mistake is removed — the soft punishment it triggered is lifted too, when the server
 * wants it (kicks and bans are never undone by this). Returns what was lifted, or null.
 */
async function revertAuto(guild, warning, by) {
  const settings = await loadSettings(guild.id);
  if (!modCfg(settings).autoRevert) return null;
  let a = null; try { a = JSON.parse(warning.autoAction || 'null'); } catch { a = null; }
  if (!a || a.status !== 'applied' || !SOFT.includes(a.action)) return null;
  const why = `Снято предупреждение #${warning.id}: откат автонаказания`;
  if (a.action === 'timeout' || a.action === 'mute') {
    const m = await guild.members.fetch(warning.userId).catch(() => null);
    if (m?.communicationDisabledUntilTimestamp > Date.now()) { await m.timeout(null, why); await recordAndAnnounce(guild, { userId: warning.userId, moderatorId: by, action: 'unmute', reason: why }); return a.action; }
    return null;
  }
  if (a.action === 'temprole') {
    const { TempRole } = require('../../db');
    const row = a.caseNumber ? await TempRole.findOne({ where: { guildId: guild.id, userId: warning.userId, caseNumber: a.caseNumber } }) : null;
    if (row) { await require('./tempRoles').removeWithCase(guild, row, { byId: by, reason: why }); return a.action; }
    return null;
  }
  const { RolePunishment } = require('../../db');
  const row = a.caseNumber ? await RolePunishment.findOne({ where: { guildId: guild.id, userId: warning.userId, caseNumber: a.caseNumber, active: true } }) : null;
  if (row) { await require('./punishments').lift(guild, row, { by, reason: why }); return a.action; }
  return null;
}

/** Lifts the temporary bans that have run out. Returns how many were lifted. */
async function liftExpiredBans(client) {
  const due = await ModLog.findAll({ where: { action: 'ban', active: true, expiresAt: { [Op.lte]: new Date() } }, limit: 50 });
  let lifted = 0;
  for (const entry of due) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) { // the bot is not on that server right now: look again in an hour, and never let such rows hold up the others
      await entry.update({ expiresAt: new Date(Date.now() + 60 * MINUTE) }).catch(() => {});
      continue;
    }
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
  warnMember, escalate, liftExpiredBans, punishmentName, describeEscalation, revokeWarning, revertAuto, pointsOf, modCfg, ruleMs, whyCannot, startModScheduler, moderatorCan, ESCALATION_ACTIONS, MAX_THRESHOLDS
};
