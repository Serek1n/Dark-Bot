const axios = require('axios');
const { getClient } = require('./botBridge');

// With the bot in the same process everything below is read from its cache; REST is the fallback (panel started alone, or a server the bot has not loaded).
const cachedGuild = (guildId) => getClient()?.guilds.cache.get(guildId) || null;

const botApi = axios.create({
  baseURL: 'https://discord.com/api/v10',
  headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  timeout: 10000
});

// Small TTL cache. Every dashboard page used to hit Discord 2-4 times; with several admins
// clicking around that burns through rate limits and slows pages down.
const cache = new Map();
const inflight = new Map(); // key -> promise of a load that is already running: parallel callers share it instead of asking Discord again
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const pending = (async () => {
    const value = await loader();
    cache.set(key, { value, expires: Date.now() + ttlMs });
    if (cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
    }
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

// Guilds of the bot (name and icon are always current here, unlike the copy saved at login).
// Discord returns at most 200 per page, so follow the pages for big bots.
function getBotGuilds() {
  const c = getClient();
  if (c) {
    const map = new Map();
    for (const g of c.guilds.cache.values()) map.set(g.id, { id: g.id, name: g.name, icon: g.icon });
    return Promise.resolve(map);
  }
  return cached('guilds', 30_000, async () => {
    const map = new Map();
    let after;
    for (let page = 0; page < 20; page++) {
      const { data } = await botApi.get('/users/@me/guilds', { params: { limit: 200, ...(after ? { after } : {}) } });
      for (const g of data) map.set(g.id, { id: g.id, name: g.name, icon: g.icon });
      if (data.length < 200) break;
      after = data[data.length - 1].id;
    }
    return map;
  });
}

async function getBotGuildIds() {
  return new Set((await getBotGuilds()).keys());
}

function getGuildChannels(guildId) {
  const g = cachedGuild(guildId);
  if (g) return Promise.resolve([...g.channels.cache.values()].map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parentId || null, position: c.rawPosition ?? 0 })));
  return cached(`channels:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}/channels`);
    return data;
  });
}

function getGuildRoles(guildId) {
  const g = cachedGuild(guildId);
  if (g) {
    return Promise.resolve(
      [...g.roles.cache.values()].filter((r) => r.name !== '@everyone').map((r) => ({ id: r.id, name: r.name, position: r.position, color: r.color, managed: r.managed })).sort((a, b) => b.position - a.position)
    );
  }
  return cached(`roles:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}/roles`);
    return data.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position);
  });
}

function getGuild(guildId) {
  const g = cachedGuild(guildId);
  if (g) return Promise.resolve({ id: g.id, name: g.name, icon: g.icon, owner_id: g.ownerId, approximate_member_count: g.memberCount });
  return cached(`guild:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}?with_counts=true`);
    return data;
  });
}

/**
 * Resolves user IDs to { id, name, avatar } for the leaderboard / mod log.
 * Cached for 10 minutes; a failed lookup falls back to the bare ID instead of breaking the page.
 */
const failedUsers = new Map(); // user id -> time until which it is not asked again
const fallbackUser = (id) => ({ id, name: id, avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' });

async function getUsers(ids) {
  const unique = [...new Set(ids)];
  const out = {};
  const queue = unique.slice();
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const known = getClient()?.users.cache.get(id);
      if (known) {
        out[id] = { id, name: known.globalName || known.username, avatar: known.displayAvatarURL({ extension: 'png', size: 64 }) };
        continue;
      }
      const miss = failedUsers.get(id);
      if (miss && miss > Date.now()) { out[id] = fallbackUser(id); continue; }
      try {
        out[id] = await cached(`user:${id}`, 10 * 60_000, async () => {
          // Through the bot when it runs here: discord.js respects Discord's rate limits and keeps the user in its cache.
          const client = getClient();
          if (client?.users?.fetch) {
            const u = await client.users.fetch(id);
            return { id, name: u.globalName || u.username, avatar: u.displayAvatarURL({ extension: 'png', size: 64 }) };
          }
          const { data } = await botApi.get(`/users/${id}`);
          const avatar = data.avatar
            ? `https://cdn.discordapp.com/avatars/${id}/${data.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
          return { id, name: data.global_name || data.username, avatar };
        });
      } catch {
        // A deleted account or a hiccup: remembered for 10 minutes, so every page load does not ask Discord again.
        if (failedUsers.size > 5000) failedUsers.clear();
        failedUsers.set(id, Date.now() + 10 * 60_000);
        out[id] = fallbackUser(id);
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

module.exports = { getBotGuilds, getBotGuildIds, getGuildChannels, getGuildRoles, getGuild, getUsers, botApi };
