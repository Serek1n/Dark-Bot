const axios = require('axios');
const cron = require('node-cron');
const { Alert } = require('../../../db');
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
    }
  });
  twitchToken = data.access_token;
  twitchTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return twitchToken;
}

async function checkYouTube(alert, client) {
  if (!process.env.YOUTUBE_API_KEY) return;
  const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      key: process.env.YOUTUBE_API_KEY,
      channelId: alert.targetId,
      part: 'snippet',
      order: 'date',
      maxResults: 1
    }
  });

  const latest = data.items?.[0];
  if (!latest) return;

  const videoId = latest.id.videoId || latest.id.channelId;
  if (!videoId) return;

  if (alert.lastSeenId === videoId) return; // already announced

  const isFirstRun = !alert.lastSeenId;
  alert.lastSeenId = videoId;
  alert.targetName = latest.snippet.channelTitle;
  await alert.save();

  if (isFirstRun) return; // don't spam-announce old videos on first setup

  const channel = await client.channels.fetch(alert.channelId).catch(() => null);
  if (!channel) return;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const text = alert.message.replace('{name}', latest.snippet.channelTitle).replace('{url}', url);
  channel.send(text).catch(() => {});
}

async function checkTwitch(alert, client) {
  const token = await getTwitchToken();
  if (!token) return;

  const { data } = await axios.get('https://api.twitch.tv/helix/streams', {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID },
    params: { user_login: alert.targetId }
  });

  const stream = data.data?.[0];
  const wasLive = alert.isLive;
  const isLiveNow = Boolean(stream);

  if (stream) alert.targetName = stream.user_name;
  alert.isLive = isLiveNow;
  await alert.save();

  if (!wasLive && isLiveNow) {
    const channel = await client.channels.fetch(alert.channelId).catch(() => null);
    if (!channel) return;
    const url = `https://twitch.tv/${alert.targetId}`;
    const text = alert.message.replace('{name}', stream.user_name).replace('{url}', url);
    channel.send(text).catch(() => {});
  }
}

async function pollOnce(client) {
  const alerts = await Alert.findAll();
  for (const alert of alerts) {
    try {
      if (alert.platform === 'youtube') await checkYouTube(alert, client);
      else if (alert.platform === 'twitch') await checkTwitch(alert, client);
    } catch (err) {
      logger.error(`Alert check failed for ${alert.platform}/${alert.targetId}:`, err.message);
    }
  }
}

function startAlertPoller(client) {
  const minutes = Number(process.env.ALERT_POLL_INTERVAL_MINUTES || 5);
  const cronExpr = `*/${minutes} * * * *`;
  cron.schedule(cronExpr, () => pollOnce(client));
  logger.info(`Alert poller scheduled every ${minutes} min`);
}

module.exports = { startAlertPoller, pollOnce };
