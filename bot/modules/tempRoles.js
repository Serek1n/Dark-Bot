// Temporary roles: /temprole gives a role until a moment, the scheduler takes it away then (also after a restart).
const { Op } = require('sequelize');
const { TempRole } = require('../../db');
const { createScheduler, poke } = require('../utils/scheduler');
const logger = require('../utils/logger');

async function give(guild, member, role, ms, byId) {
  const expiresAt = new Date(Date.now() + ms);
  await member.roles.add(role, `Временная роль до ${expiresAt.toISOString()}`);
  const [row, created] = await TempRole.findOrCreate({ where: { guildId: guild.id, userId: member.id, roleId: role.id }, defaults: { expiresAt, givenBy: byId } });
  if (!created) await row.update({ expiresAt, givenBy: byId }); // given again: the new end counts
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
  await member.roles.add(roleId, reason);
  if (row) await row.update({ expiresAt, givenBy: byId });
  else await TempRole.create({ guildId: guild.id, userId: member.id, roleId, expiresAt, givenBy: byId });
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
  await member.send?.({ content: `⏳ Срок роли **${name}** на сервере **${guild.name}** закончился. Продлить можно командой \`/shop\` на сервере.`, allowedMentions: { parse: [] } }).catch(() => {});
}

async function tick(client) {
  const due = await TempRole.findAll({ where: { expiresAt: { [Op.lte]: new Date() } }, limit: 50 });
  for (const row of due) {
    await row.reload().catch(() => null);
    if (new Date(row.expiresAt).getTime() > Date.now()) continue; // prolonged in the meantime (bought again)
    const guild = client.guilds.cache.get(row.guildId);
    if (guild) {
      const member = await guild.members.fetch(row.userId).catch(() => null);
      if (member?.roles.cache.has(row.roleId)) {
        const ok = await member.roles.remove(row.roleId, 'Временная роль закончилась').then(() => true).catch((err) => { logger.warn(`temprole remove: ${err.message}`); return false; });
        if (!ok) continue; // try again later (rights, Discord hiccup)
        if (String(row.givenBy || '').startsWith('shop:')) await tellEnded(member, guild, row.roleId);
      }
    }
    await row.destroy();
  }
}

let scheduler = null;
function startTempRoleScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'temproles', nextDue: () => TempRole.min('expiresAt'), run: () => tick(client) }).start();
}

module.exports = { give, giveOrExtend, termOf, tick, startTempRoleScheduler };
