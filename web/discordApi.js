const axios = require('axios');

const botApi = axios.create({
  baseURL: 'https://discord.com/api/v10',
  headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  timeout: 10000
});

// Small TTL cache. Every dashboard page used to hit Discord 2-4 times; with several admins
// clicking around that burns through rate limits and slows pages down.
const cache = new Map();
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  }
  return value;
}

function getBotGuildIds() {
  return cached('guilds', 30_000, async () => {
    const { data } = await botApi.get('/users/@me/guilds');
    return new Set(data.map((g) => g.id));
  });
}

function getGuildChannels(guildId) {
  return cached(`channels:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}/channels`);
    return data;
  });
}

function getGuildRoles(guildId) {
  return cached(`roles:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}/roles`);
    return data.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position);
  });
}

function getGuild(guildId) {
  return cached(`guild:${guildId}`, 30_000, async () => {
    const { data } = await botApi.get(`/guilds/${guildId}?with_counts=true`);
    return data;
  });
}

/**
 * Resolves user IDs to { id, name, avatar } for the leaderboard / mod log.
 * Cached for 10 minutes; a failed lookup falls back to the bare ID instead of breaking the page.
 */
async function getUsers(ids) {
  const unique = [...new Set(ids)];
  const out = {};
  const queue = unique.slice();
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        out[id] = await cached(`user:${id}`, 10 * 60_000, async () => {
          const { data } = await botApi.get(`/users/${id}`);
          const avatar = data.avatar
            ? `https://cdn.discordapp.com/avatars/${id}/${data.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
          return { id, name: data.global_name || data.username, avatar };
        });
      } catch {
        out[id] = { id, name: id, avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' };
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

module.exports = { getBotGuildIds, getGuildChannels, getGuildRoles, getGuild, getUsers };
