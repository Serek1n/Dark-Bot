// The temporary voice rooms the bot knows about: their ids in memory (so an ordinary voice event costs no database
// query) and the clean-up after downtime (a room that emptied while the bot was off would otherwise stay forever).
const { TempVoiceChannel } = require('../../db');
const logger = require('../utils/logger');

let known = null;
let loading = null;

async function ids() {
  if (known) return known;
  loading = loading || TempVoiceChannel.findAll({ attributes: ['channelId'], raw: true }).then((rows) => new Set(rows.map((r) => r.channelId)));
  const set = await loading;
  if (!known) known = set;
  return known;
}

async function isTempRoom(channelId) { return (await ids()).has(channelId); }
function rememberTempRoom(channelId) { if (known) known.add(channelId); }
function forgetTempRoom(channelId) { if (known) known.delete(channelId); }
function resetTempRooms() { known = null; loading = null; }

// Whoever creates a room record (the voice event, a test, a future command) — the set learns about it.
TempVoiceChannel.addHook('afterCreate', 'tempRoomsRemember', (row) => rememberTempRoom(row.channelId));

/** At start: rooms that emptied (or were deleted) while the bot was not running. Returns how many were removed. */
async function sweepTempRooms(client) {
  const rows = await TempVoiceChannel.findAll();
  let removed = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild || guild.available === false) continue; // not on that server right now: its rows wait
    try {
      const channel = await guild.channels.fetch(row.channelId).catch((err) => (err?.code === 10003 || err?.status === 404 ? null : undefined));
      if (channel === undefined) continue; // Discord did not answer: decide next time
      if (channel && channel.members?.size > 0) continue;
      if (channel) await channel.delete('Пустая временная комната').catch(() => {});
      await row.destroy();
      forgetTempRoom(row.channelId);
      removed++;
    } catch (err) {
      logger.warn(`temp room sweep: ${err.message}`);
    }
  }
  if (removed) logger.info(`Temporary rooms removed after downtime: ${removed}`);
  return removed;
}

module.exports = { isTempRoom, rememberTempRoom, forgetTempRoom, resetTempRooms, sweepTempRooms };
