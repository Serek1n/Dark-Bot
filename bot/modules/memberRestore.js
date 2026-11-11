// A member who leaves and comes back gets his roles and nickname back. His level, XP, coins, crystals,
// purchases and warnings are never deleted when he leaves, so they simply continue.
const { PermissionsBitField } = require('discord.js');
const { Op } = require('sequelize');
const { GuildSettings, MemberSnapshot, MemberProfile } = require('../../db');
const logger = require('../utils/logger');
const L = require('./serverLog');
const { withLock } = require('../utils/lock');

const F = PermissionsBitField.Flags;
// Roles with these rights are not given back automatically unless the admin allows it: a person who left
// (or was kicked) must not return as a moderator by himself.
const STAFF_PERMISSIONS = [F.Administrator, F.ManageGuild, F.ManageRoles, F.ManageChannels, F.ManageWebhooks, F.ManageMessages, F.ManageNicknames, F.KickMembers, F.BanMembers, F.ModerateMembers, F.MentionEveryone, F.ViewAuditLog];
const DEFAULT_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

const isOn = (s) => !s || s.restoreOnRejoin !== false && s.restoreOnRejoin !== 0;
const daysOf = (s) => Number(s?.restoreDays) > 0 ? Number(s.restoreDays) : DEFAULT_DAYS;
const parseIds = (text) => { try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const isStaffRole = (role) => Boolean(role.permissions?.any?.(STAFF_PERMISSIONS));

/** Is the leaving member banned? Asked from the ban list; a bot without "Ban Members" cannot read it (and gets no ban
 *  events either), so then the audit log is asked for a ban of this member in the last seconds. */
async function wasBanned(member) {
  const guild = member.guild;
  const viaList = await guild.bans?.fetch?.({ user: member.id, force: true }).then(() => true).catch((err) => (err?.code === 10026 || /unknown ban/i.test(String(err?.message)) ? false : null));
  if (viaList !== null && viaList !== undefined) return viaList;
  try {
    const logs = await guild.fetchAuditLogs?.({ type: 22, limit: 5 }); // 22 = MemberBanAdd
    const hit = logs?.entries?.find?.((e) => (e.targetId || e.target?.id) === member.id && Date.now() - e.createdTimestamp < 60_000);
    return Boolean(hit);
  } catch { return false; }
}

/** Remembers the roles and the nickname of a member who is leaving. Never throws. */
async function saveSnapshot(member) {
  try {
    if (!member?.guild || member.user?.bot) return;
    const settings = await require('./leveling').getOrCreateSettings(member.guild.id);
    if (!isOn(settings)) return;
    if (member.partial || !member.roles?.cache) return; // roles unknown: an older snapshot, if any, stays
    // A banned member comes back (after an unban) with nothing: the punishment is not undone by roles.
    const banned = await wasBanned(member);
    const key = { guildId: member.guild.id, userId: member.id };
    if (banned) return void (await MemberSnapshot.destroy({ where: key }));
    const roleIds = [...member.roles.cache.keys()].filter((id) => id !== member.guild.id).slice(0, 250);
    const nickname = member.nickname || null;
    const until = member.communicationDisabledUntilTimestamp > Date.now() ? new Date(member.communicationDisabledUntilTimestamp) : null;
    if (!roleIds.length && !nickname && !until) return void (await MemberSnapshot.destroy({ where: key }));
    // ONE statement (insert or replace the row of this member): a crash can no longer land between "delete" and "create" and lose the snapshot.
    await withLock(`snapshot:${key.guildId}:${key.userId}`, () =>
      MemberSnapshot.upsert({ ...key, roleIds: JSON.stringify(roleIds), nickname, mutedUntil: until, leftAt: new Date() })
    );
  } catch (err) {
    logger.warn('Member snapshot failed:', err.message);
  }
}

/** The member was banned: forget what he had. */
async function forgetMember(guildId, userId) {
  await MemberSnapshot.destroy({ where: { guildId, userId } }).catch(() => {});
}

/** Gives back what was saved for a member who has just joined. Returns what was done, or null. Never throws. */
async function restoreMember(member) {
  try {
    if (!member?.guild || member.user?.bot) return null;
    const guild = member.guild;
    const settings = await require('./leveling').getOrCreateSettings(guild.id);
    if (!isOn(settings)) return null;
    const key = { guildId: guild.id, userId: member.id };
    const snap = await MemberSnapshot.findOne({ where: key });
    if (!snap) return null;
    if (Date.now() - new Date(snap.leftAt).getTime() > daysOf(settings) * DAY) { await snap.destroy(); return null; }

    const top = guild.members?.me?.roles?.highest?.position ?? 0;
    const have = new Set([...(member.roles?.cache?.keys?.() || [])]);
    const allowStaff = Boolean(settings?.restoreStaffRoles);
    const given = []; const skipped = [];
    for (const id of parseIds(snap.roleIds)) {
      const role = guild.roles.cache.get(id);
      if (!role || id === guild.id || have.has(id)) continue; // deleted since, or already given (autorole)
      if (role.managed || role.position >= top || (!allowStaff && isStaffRole(role))) { skipped.push(id); continue; }
      given.push(id);
    }
    if (given.length) {
      const reason = 'Участник вернулся на сервер: роли восстановлены';
      try { await member.roles.add(given, reason); } catch {
        const done = [];
        for (const id of given) { try { await member.roles.add(id, reason); done.push(id); } catch { skipped.push(id); } }
        // Discord refused every role (an outage, not a matter of rights): keep the snapshot instead of losing the roles for good.
        if (!done.length && given.length) { logger.warn(`Roles of ${member.id} were not restored in ${guild.id}: the snapshot is kept`); return null; }
        given.splice(0, given.length, ...done);
      }
    }
    await snap.destroy(); // used once; if he leaves again a new one is made
    let nickname = null;
    if (snap.nickname && !member.nickname && member.manageable !== false && typeof member.setNickname === 'function') {
      try { await member.setNickname(snap.nickname, 'Участник вернулся на сервер: никнейм восстановлен'); nickname = snap.nickname; } catch { /* the bot may not be allowed */ }
    }
    // A timeout that was still running when he left continues: leaving and coming back does not end a punishment.
    let mutedUntil = null;
    const left = snap.mutedUntil ? new Date(snap.mutedUntil).getTime() - Date.now() : 0;
    if (left > 1000 && typeof member.timeout === 'function') {
      try { await member.timeout(Math.min(left, 28 * DAY), 'Участник вернулся на сервер: таймаут продолжается'); mutedUntil = new Date(snap.mutedUntil); } catch { /* the bot may not be allowed */ }
    }
    // Level roles for the level he has now (the server may have set up new ones while he was away).
    try {
      const profile = await MemberProfile.findOne({ where: key });
      if (profile) {
        const { levelsOf } = require('./leveling');
        await require('./levelRoles').applyLevelRoles(member, levelsOf(profile), settings?.levelRolesReplace);
      }
    } catch (err) { logger.warn('Level roles after return failed:', err.message); }

    const result = { roles: given, skipped, nickname, mutedUntil, leftAt: snap.leftAt };
    if (given.length || nickname || mutedUntil) {
      await L.log(guild.id, 'members', (base) => base(0x7f8bff)
        .setTitle('🔁 Участник вернулся')
        .setDescription(`<@${member.id}>: данные участника восстановлены`)
        .addFields(
          { name: 'Роли', value: given.length ? given.map((id) => `<@&${id}>`).join(' ').slice(0, 1000) : 'нет', inline: false },
          ...(skipped.length ? [{ name: 'Не возвращены (нет прав у бота или роль с правами модератора)', value: skipped.map((id) => `<@&${id}>`).join(' ').slice(0, 1000) }] : []),
          ...(nickname ? [{ name: 'Никнейм', value: nickname.slice(0, 100), inline: true }] : []),
          ...(mutedUntil ? [{ name: 'Таймаут продолжается до', value: `<t:${Math.floor(mutedUntil.getTime() / 1000)}:f>`, inline: true }] : [])
        )).catch(() => {});
    }
    return result;
  } catch (err) {
    logger.warn('Member restore failed:', err.message);
    return null;
  }
}

/** Deletes snapshots older than the period each server chose (once a day). */
async function purgeOld(now = Date.now()) {
  const rows = await GuildSettings.findAll({ attributes: ['guildId', 'restoreDays'] });
  let removed = 0;
  for (const s of rows) removed += await MemberSnapshot.destroy({ where: { guildId: s.guildId, leftAt: { [Op.lt]: new Date(now - daysOf(s) * DAY) } } });
  removed += await MemberSnapshot.destroy({ where: { leftAt: { [Op.lt]: new Date(now - 3650 * DAY) } } }); // servers without settings
  return removed;
}

function startRestoreCleanup() {
  const run = () => purgeOld().catch((err) => logger.warn('Snapshot cleanup failed:', err.message));
  run();
  setInterval(run, DAY).unref?.();
}

module.exports = { saveSnapshot, restoreMember, forgetMember, purgeOld, startRestoreCleanup, isStaffRole, DEFAULT_DAYS };
