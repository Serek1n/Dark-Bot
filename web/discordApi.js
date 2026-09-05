const axios = require('axios');

const botApi = axios.create({
  baseURL: 'https://discord.com/api/v10',
  headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
});

async function getBotGuildIds() {
  const { data } = await botApi.get('/users/@me/guilds');
  return new Set(data.map((g) => g.id));
}

async function getGuildChannels(guildId) {
  const { data } = await botApi.get(`/guilds/${guildId}/channels`);
  return data;
}

async function getGuildRoles(guildId) {
  const { data } = await botApi.get(`/guilds/${guildId}/roles`);
  return data.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position);
}

async function getGuild(guildId) {
  const { data } = await botApi.get(`/guilds/${guildId}`);
  return data;
}

module.exports = { getBotGuildIds, getGuildChannels, getGuildRoles, getGuild };
