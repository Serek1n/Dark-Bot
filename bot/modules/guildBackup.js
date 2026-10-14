// Safety net for a bot that was removed by accident: everything about the server (settings, levels, shop,
// roles, warnings...) stays in the database for 14 days. Add the bot back within that time and it all
// works as before; after that the server's data is deleted.
const { Op } = require('sequelize');
const { sequelize, GuildSettings } = require('../../db');
const logger = require('../utils/logger');

const RETENTION_DAYS = 14;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CHECK_MS = 60 * 60 * 1000;

/** Marks the server as left. Keeps the first moment if the bot was already marked. */
async function markLeft(guildId, now = new Date()) {
  const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
  if (!settings.leftAt) await settings.update({ leftAt: now });
  return settings;
}

/**
 * The bot is back: clear the mark. The old log webhook died with the bot, so it is forgotten here;
 * pressing "Сохранить" on the "Логи сервера" page makes a new one and reuses the existing posts.
 * Returns true when saved data was restored.
 */
async function restore(guildId) {
  const settings = await GuildSettings.findOne({ where: { guildId } });
  if (!settings || !settings.leftAt) return false;
  const changes = { leftAt: null };
  if (settings.logWebhookId) Object.assign(changes, { logWebhookId: null, logWebhookToken: null });
  await settings.update(changes);
  return true;
}

/** Servers with saved data that the bot is no longer in (it may have been removed while it was offline). */
async function reconcile(client) {
  const rows = await GuildSettings.findAll({ where: { leftAt: null }, attributes: ['guildId'] });
  let marked = 0;
  for (const { guildId } of rows) {
    if (client.guilds.cache.has(guildId)) continue;
    await markLeft(guildId);
    marked++;
  }
  // A server the bot is in again (re-invited while it was offline) is restored.
  const absent = await GuildSettings.findAll({ where: { leftAt: { [Op.ne]: null } }, attributes: ['guildId'] });
  for (const { guildId } of absent) if (client.guilds.cache.has(guildId) && (await restore(guildId))) logger.info(`Server ${guildId}: saved data restored.`);
  return marked;
}

/** Deletes the data of servers that have been gone for more than 14 days. Returns their ids. */
async function purgeExpired(client, now = Date.now()) {
  const expired = await GuildSettings.findAll({ where: { leftAt: { [Op.lt]: new Date(now - RETENTION_MS) } }, attributes: ['guildId'] });
  const purged = [];
  for (const { guildId } of expired) {
    if (client.guilds.cache.has(guildId)) { await restore(guildId); continue; } // came back: never delete
    await sequelize.transaction(async (transaction) => {
      for (const model of Object.values(sequelize.models)) {
        if (model.rawAttributes.guildId) await model.destroy({ where: { guildId }, transaction });
      }
    });
    purged.push(guildId);
    logger.info(`Server ${guildId}: ${RETENTION_DAYS} days passed since the bot was removed, saved data deleted.`);
  }
  return purged;
}

function startGuildBackup(client) {
  const run = () => reconcile(client).then(() => purgeExpired(client)).catch((err) => logger.error('Guild backup error:', err));
  run();
  setInterval(run, CHECK_MS).unref?.();
}

module.exports = { RETENTION_DAYS, markLeft, restore, reconcile, purgeExpired, startGuildBackup };
