// Webhooks from the panel: list the ones this bot made, create, delete and post through them.
const axios = require('axios');
const { botApi } = require('./discordApi');
const { isPrivateIp, safeLookup, fetchAvatar } = require('../bot/utils/safeImage');

/** The bot's own picture, used when no avatar was given. */
async function botAvatar() {
  const { data } = await botApi.get('/users/@me');
  if (!data.avatar) return undefined;
  return fetchAvatar(`https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=256`).catch(() => undefined);
}

/** Webhooks created by this bot (the only ones with a usable link), without the log webhook. */
async function listOwn(guildId, botId, logWebhookId) {
  const { data } = await botApi.get(`/guilds/${guildId}/webhooks`);
  return data.filter((w) => w.application_id === botId && w.token && w.id !== logWebhookId);
}

async function create(channelId, name, avatarUrl, reason) {
  const avatar = avatarUrl ? await fetchAvatar(avatarUrl) : await botAvatar();
  const { data } = await botApi.post(`/channels/${channelId}/webhooks`, { name, ...(avatar ? { avatar } : {}) }, { headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) } });
  return data;
}

const remove = (id, reason) => botApi.delete(`/webhooks/${id}`, { headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) } });

/** The framed look (same orange bar as the bot's own messages). */
const frame = (title, text) => ({ color: 0xe3a857, ...(title ? { title: String(title).slice(0, 256) } : {}), description: String(text).slice(0, 4000), timestamp: new Date().toISOString() });

/** Posts through a webhook, as plain text or in a frame; no mentions are parsed, so @everyone stays text. */
const send = (hook, { content, username, avatarUrl, framed, title }) =>
  axios.post(`https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}`, { ...(framed ? { embeds: [frame(title, content)] } : { content }), ...(username ? { username } : {}), ...(avatarUrl ? { avatar_url: avatarUrl } : {}), allowed_mentions: { parse: [] } }, { timeout: 10000 });

const explain = (err) => {
  const m = err.response?.data?.message || err.message || '';
  const code = err.response?.data?.code;
  if (code === 30007 || /Maximum number of webhooks/i.test(m)) return 'В этом канале уже 15 вебхуков — предел Discord.';
  if (code === 50013 || code === 50001 || err.response?.status === 403) return 'У бота нет права «Управлять вебхуками» в этом канале.';
  return m || 'Discord отказал.';
};

module.exports = { listOwn, create, remove, send, fetchAvatar, explain, isPrivateIp, safeLookup };
