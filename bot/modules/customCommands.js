// Custom commands ("!rules") are looked up on EVERY message that starts with the server's prefix. The list of a server is kept in memory
// and reloaded when it changes (the panel runs in this same process, so its saves clear the cache at once).
const { CustomCommand } = require('../../db');

const TTL_MS = 60_000; // a safety net, in case the panel is run as a separate process
const cache = new Map(); // guildId -> { map: Map(trigger -> response), expires }

['afterSave', 'afterUpsert', 'afterDestroy', 'afterBulkCreate', 'afterBulkUpdate', 'afterBulkDestroy'].forEach((hook) => CustomCommand.addHook(hook, () => cache.clear()));

async function listFor(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.map;
  const rows = await CustomCommand.findAll({ where: { guildId }, attributes: ['trigger', 'response'] });
  const map = new Map(rows.map((r) => [r.trigger, r.response]));
  if (cache.size > 2000) cache.clear();
  cache.set(guildId, { map, expires: Date.now() + TTL_MS });
  return map;
}

/** The answer of the custom command `trigger` on this server, or null. */
async function findCustomResponse(guildId, trigger) {
  return (await listFor(guildId)).get(trigger) ?? null;
}

module.exports = { findCustomResponse };
