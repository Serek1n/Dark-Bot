// Temporary roles: /temprole gives a role until a moment, the scheduler takes it away then (also after a restart).
const { Op } = require('sequelize');
const { TempRole } = require('../../db');
const { createScheduler, poke } = require('../utils/scheduler');
const logger = require('../utils/logger');

// The term is written BEFORE the role is given: a crash between the two then leaves a term without a role (the scheduler
// simply finds nothing to take away), never a role without a term. If Discord refuses the role, the term is put back.
async function give(guild, member, role, ms, byId) {
  const expiresAt = new Date(Date.now() + ms);
  const [row, created] = await TempRole.findOrCreate({ where: { guildId: guild.id, userId: member.id, roleId: role.id }, defaults: { expiresAt, givenBy: byId } });
  const before = created ? null : { expiresAt: row.expiresAt, givenBy: row.givenBy };
  if (!created) await row.update({ expiresAt, givenBy: byId }); // given again: the new end counts
  try {
    await member.roles.add(role, `Временная роль до ${expiresAt.toISOString()}`);
  } catch (err) {
    if (created) await row.destroy().catch(() => {}); else await row.update(before).catch(() => {});
    throw err;
  }
  poke('temproles');
  return expiresAt;
}

/**
 * A role for a while that can be prolonged (the shop): if the member already holds it on a term, the term grows from its
 * current end; otherwise the role is given and the term starts now. Returns { expiresAt, extended }.
 * Throws when Discord refuses to give the role (nothing is stored then).
 */
async function giveOrExtend(guild, member, roleId, ms, byId, reason) {
  const row = await TempRole.findOne({ where: { guildId: guild.id, userId: member.id, roleId } });
  if (row && member.roles.cache.has(roleId)) {
    const expiresAt = new Date(Math.max(new Date(row.expiresAt).getTime(), Date.now()) + ms);
    await row.update({ expiresAt });
    poke('temproles');
    return { expiresAt, extended: true };
  }
  const expiresAt = new Date(Date.now() + ms);
  // the term first, then the role (see give): a crash in between never leaves the role for good
  const before = row ? { expiresAt: row.expiresAt, givenBy: row.givenBy } : null;
  const stored = row ? await row.update({ expiresAt, givenBy: byId }) : await TempRole.create({ guildId: guild.id, userId: member.id, roleId, expiresAt, givenBy: byId });
  try {
    await member.roles.add(roleId, reason);
  } catch (err) {
    if (before) await stored.update(before).catch(() => {}); else await stored.destroy().catch(() => {});
    throw err;
  }
  poke('temproles');
  return { expiresAt, extended: false };
}

/** Is this member's role on a term (and until when)? null when it is not. */
async function termOf(guildId, userId, roleId) {
  const row = await TempRole.findOne({ where: { guildId, userId, roleId } });
  return row ? new Date(row.expiresAt) : null;
}

/** A role bought for a while has ended: a short DM, so the buyer knows why it is gone and how to get it back. Never throws. */
async function tellEnded(member, guild, roleId) {
  const name = guild.roles?.cache?.get(roleId)?.name || 'роль';
  await require('./userData').sendOptionalDm(member, { content: `⏳ Срок роли **${name}** на сервере **${guild.name}** закончился. Продлить можно командой \`/shop\` на сервере.`, allowedMentions: { parse: [] } });
}

const RETRY_MS = 10 * 60 * 1000;
const later = (row, ms = RETRY_MS) => row.update({ expiresAt: new Date(Date.now() + ms) }).catch(() => {});

/** The member has left with a role that has now ended: it must not come back with him as a role for good. */
async function dropFromSnapshot(row) {
  const { MemberSnapshot } = require('../../db');
  const snap = await MemberSnapshot.findOne({ where: { guildId: row.guildId, userId: row.userId } }).catch(() => null);
  if (!snap) return;
  let ids = []; try { ids = JSON.parse(snap.roleIds || '[]'); } catch { ids = []; }
  if (ids.includes(row.roleId)) await snap.update({ roleIds: JSON.stringify(ids.filter((id) => id !== row.roleId)) });
}

/**
 * Takes away the roles whose term has come. The record of a term is removed only when the role is really gone: taken away,
 * not held any more, or the member has left (then the role is also struck out of his saved roles, see memberRestore).
 * When Discord could not be asked (429, 5xx, a timeout) or the server is not available right now, the record waits.
 */
async function tick(client) {
  const { isGone } = require('../utils/discordErrors');
  const due = await TempRole.findAll({ where: { expiresAt: { [Op.lte]: new Date() } }, limit: 50 });
  for (const row of due) {
    await row.reload().catch(() => null);
    if (new Date(row.expiresAt).getTime() > Date.now()) continue; // prolonged in the meantime (bought again)
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) { await later(row, 60 * 60 * 1000); continue; } // not connected to this server right now: ask again in an hour
    let member = null;
    try { member = await guild.members.fetch(row.userId); } catch (err) {
      if (!isGone(err)) { logger.warn(`temprole fetch: ${err.message}`); await later(row); continue; } // could not ask: later
      await dropFromSnapshot(row).catch(() => {}); // he has left: his saved roles lose this one
      await row.destroy();
      continue;
    }
    if (member.roles.cache.has(row.roleId)) {
      const ok = await member.roles.remove(row.roleId, 'Временная роль закончилась').then(() => true).catch((err) => {
        if (isGone(err)) return true; // the role itself was deleted
        logger.warn(`temprole remove: ${err.message}`); return false;
      });
      if (!ok) { await later(row); continue; } // rights or a Discord hiccup: try again in 10 minutes
      if (String(row.givenBy || '').startsWith('shop:')) await tellEnded(member, guild, row.roleId);
    }
    await row.destroy();
  }
}

let scheduler = null;
function startTempRoleScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'temproles', nextDue: () => TempRole.min('expiresAt'), run: () => tick(client) }).start();
}

module.exports = { give, giveOrExtend, termOf, tick, startTempRoleScheduler, wake: () => scheduler?.wake?.() };
