const axios = require('axios');
const cron = require('node-cron');
const { Alert } = require('../../../db');
const { getOrCreateSettings } = require('../leveling');
const logger = require('../../utils/logger');

let twitchToken = null;
let twitchTokenExpiresAt = 0;

async function getTwitchToken() {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return null;
  if (twitchToken && Date.now() < twitchTokenExpiresAt) return twitchToken;

  const { data } = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    },
    timeout: 15000 // a hung request would otherwise keep `polling` set and stop every alert until a restart
  });
  twitchToken = data.access_token;
  twitchTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return twitchToken;
}

/** The channel to post into, only if it belongs to the alert's own server. */
async function alertChannel(client, alert) {
  const channel = await client.channels.fetch(alert.channelId).catch(() => null);
  return channel && channel.guildId === alert.guildId ? channel : null;
}

async function checkYouTube(alert, client) {
  if (!process.env.YOUTUBE_API_KEY) return;

  // Newest upload via the channel's "uploads" playlist (UC... -> UU...). This costs 1 quota unit
  // per check, while the search endpoint costs 100 and would burn the free daily quota
  // (10 000 units) in under two hours at a 5-minute interval.
  const channelId = alert.targetId;
  if (!/^UC[\w-]{20,}$/.test(channelId)) {
    throw new Error('ID канала YouTube должен начинаться с UC (например, UCxxxxxxxxxxxxxxxxxxxxxx)');
  }
  const uploadsId = `UU${channelId.slice(2)}`;
  const { data } = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: { key: process.env.YOUTUBE_API_KEY, playlistId: uploadsId, part: 'snippet', maxResults: 1 },
    timeout: 15000
  });

  const latest = data.items?.[0];
  if (!latest) return;

  const videoId = latest.snippet?.resourceId?.videoId;
  if (!videoId) return;
  if (alert.lastSeenId === videoId) return; // already announced

  const isFirstRun = !alert.lastSeenId;
  const channelTitle = latest.snippet.videoOwnerChannelTitle || latest.snippet.channelTitle || alert.targetName || channelId;
  alert.lastSeenId = videoId;
  alert.targetName = channelTitle;
  await alert.save();

  if (isFirstRun) return; // don't spam-announce old videos on first setup

  const channel = await alertChannel(client, alert);
  if (!channel) return;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const text = alert.message.replaceAll('{name}', channelTitle).replaceAll('{url}', url);
  channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

async function checkTwitch(alert, client) {
  const token = await getTwitchToken();
  if (!token) return;

  const { data } = await axios.get('https://api.twitch.tv/helix/streams', {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID },
    params: { user_login: alert.targetId },
    timeout: 15000
  }).catch((err) => {
    if (err.response?.status === 401) { twitchToken = null; twitchTokenExpiresAt = 0; } // revoked token: get a new one next time
    throw err;
  });

  const stream = data.data?.[0];
  const wasLive = alert.isLive;
  const isLiveNow = Boolean(stream);

  if (stream) alert.targetName = stream.user_name;
  alert.isLive = isLiveNow;
  await alert.save();

  if (!wasLive && isLiveNow) {
    const channel = await alertChannel(client, alert);
    if (!channel) return;
    const url = `https://twitch.tv/${alert.targetId}`;
    const text = alert.message.replaceAll('{name}', stream.user_name).replaceAll('{url}', url);
    channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

let polling = false;
async function pollOnce(client) {
  if (polling) return; // previous round still running (slow API) — don't overlap
  polling = true;
  try {
    await pollAll(client);
  } finally {
    polling = false;
  }
}

async function pollAll(client) {
  const alerts = await Alert.findAll();
  for (const alert of alerts) {
    try {
      // Switched off in the panel: skip (nothing is marked as seen, so it catches up when turned back on).
      if (!(await getOrCreateSettings(alert.guildId)).alertsEnabled) continue;
      if (alert.platform === 'youtube') await checkYouTube(alert, client);
      else if (alert.platform === 'twitch') await checkTwitch(alert, client);
    } catch (err) {
      logger.error(`Alert check failed for ${alert.platform}/${alert.targetId}:`, err.message);
    }
  }
}

function startAlertPoller(client) {
  const minutes = Math.min(59, Math.max(1, Math.floor(Number(process.env.ALERT_POLL_INTERVAL_MINUTES) || 5)));
  const cronExpr = `*/${minutes} * * * *`;
  cron.schedule(cronExpr, () => pollOnce(client).catch((err) => logger.error('Alert poll failed:', err.message)));
  logger.info(`Alert poller scheduled every ${minutes} min`);
}

module.exports = { startAlertPoller, pollOnce };
