// Webhooks from the panel: list the ones this bot made, create, delete and post through them.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { botApi } = require('./discordApi');

const MAX_AVATAR = 8 * 1024 * 1024;

const isPrivateIp = (ip) => {
  if (net.isIPv6(ip)) return /^(::1?$|f[cd]|fe[89ab]|::ffff:(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
};

/** Downloads a picture the admin pointed to and returns it as a data URI. Only https, never an internal address. */
async function fetchAvatar(url) {
  let u; try { u = new URL(url); } catch { throw new Error('Ссылка на картинку некорректна.'); }
  if (u.protocol !== 'https:') throw new Error('Ссылка на картинку должна начинаться с https://');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('По этой ссылке нельзя загрузить картинку.');
  const res = await axios.get(u.href, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX_AVATAR, maxRedirects: 0, validateStatus: (s) => s === 200 }).catch(() => { throw new Error('Не удалось скачать картинку по ссылке.'); });
  const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) throw new Error('Аватарка должна быть PNG, JPG, GIF или WebP.');
  return `data:${type};base64,${Buffer.from(res.data).toString('base64')}`;
}

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

/** Posts through a webhook; no mentions are parsed, so @everyone stays text. */
const send = (hook, { content, username, avatarUrl }) =>
  axios.post(`https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}`, { content, ...(username ? { username } : {}), ...(avatarUrl ? { avatar_url: avatarUrl } : {}), allowed_mentions: { parse: [] } }, { timeout: 10000 });

const explain = (err) => {
  const m = err.response?.data?.message || err.message || '';
  const code = err.response?.data?.code;
  if (code === 30007 || /Maximum number of webhooks/i.test(m)) return 'В этом канале уже 15 вебхуков — предел Discord.';
  if (code === 50013 || code === 50001 || err.response?.status === 403) return 'У бота нет права «Управлять вебхуками» в этом канале.';
  return m || 'Discord отказал.';
};

module.exports = { listOwn, create, remove, send, fetchAvatar, explain, isPrivateIp };
