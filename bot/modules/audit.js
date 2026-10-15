// Who did it: looks the action up in the server's audit log. Needs the "View Audit Log" permission;
// without it (or when Discord has no entry, e.g. a member deleted their own message) the answer is null.
const { AuditLogEvent: E, PermissionFlagsBits } = require('discord.js');

const MAX_AGE = 20_000; // an entry older than this belongs to some earlier action
const SHARE_MS = 1000; // events that arrive together share one request
const batches = new Map(); // guildId -> { at, promise }
const used = new Set(); // entries already given to one event (so two events do not get the same actor)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recent(guild) {
  const hit = batches.get(guild.id);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.promise;
  const promise = guild.fetchAuditLogs({ limit: 30 }).then((logs) => [...logs.entries.values()]).catch(() => []);
  batches.set(guild.id, { at: Date.now(), promise });
  if (batches.size > 500) batches.delete(batches.keys().next().value);
  return promise;
}

/**
 * @param types  audit log event(s) that can describe this action
 * @param match  (entry) => boolean, usually compares entry.targetId
 * @param opts   wait: pause before the first look (the entry may lag behind the event); tries; consume: false for
 *               entries that cover several events (message deletions are counted inside one entry)
 */
async function find(guild, types, match, { wait = 0, tries = 2, consume = true } = {}) {
  try {
    if (!guild || typeof guild.fetchAuditLogs !== 'function') return null;
    const me = guild.members?.me;
    if (me && !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const list = Array.isArray(types) ? types : [types];
    if (wait) await sleep(wait);
    for (let i = 0; i < tries; i++) {
      const entries = await recent(guild);
      const hit = entries.find((e) => list.includes(e.action) && !used.has(e.id) && Date.now() - e.createdTimestamp < MAX_AGE && match(e));
      if (hit) {
        if (consume) {
          used.add(hit.id);
          if (used.size > 2000) used.delete(used.values().next().value);
        }
        return hit;
      }
      if (i < tries - 1) await sleep(SHARE_MS + 200);
    }
  } catch {
    // an audit log problem must never break logging
  }
  return null;
}

/** Fields "Кто" / "Причина" for an embed (an empty list when the actor is unknown). */
function actorFields(entry, label = 'Кто') {
  if (!entry) return [];
  const out = [];
  if (entry.executorId) out.push({ name: label, value: `<@${entry.executorId}>`, inline: true });
  if (entry.reason) out.push({ name: 'Причина', value: String(entry.reason).slice(0, 1000) });
  return out;
}

const changed = (entry, key) => Boolean(entry?.changes?.some?.((c) => c.key === key));

module.exports = { find, actorFields, changed, E };
