// The list of the user's servers used to be frozen at the moment of login: a new server or a renamed one
// never showed up until the user logged in again. Here it is re-read from Discord with the user's own
// token (refreshed when it expires) and kept in the session; on any failure the saved list is used.
const axios = require('axios');

const MIN_INTERVAL = 20_000; // do not ask Discord more often than this per user
const MAX_STALE = 60 * 60_000; // if the list could not be refreshed for an hour, the saved rights are no longer trusted
const api = axios.create({ baseURL: 'https://discord.com/api/v10', timeout: 8000 });

async function refreshAccessToken(user) {
  if (!user.refreshToken) return null;
  const { data } = await api.post(
    '/oauth2/token',
    new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: user.refreshToken }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  user.accessToken = data.access_token;
  if (data.refresh_token) user.refreshToken = data.refresh_token;
  return user.accessToken;
}

const fetchGuilds = (token) => api.get('/users/@me/guilds', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

/** Returns the freshest list of the user's guilds and stores it in req.user (and so in the session). */
async function refreshUserGuilds(req, { force = false } = {}) {
  const user = req.user;
  if (!user) return [];
  if (!force && user.guildsAt && Date.now() - user.guildsAt < MIN_INTERVAL) return user.guilds || [];
  try {
    let guilds;
    try {
      guilds = await fetchGuilds(user.accessToken);
    } catch (err) {
      if (err?.response?.status !== 401) throw err;
      guilds = await fetchGuilds(await refreshAccessToken(user)); // the token expired: renew it once
    }
    if (Array.isArray(guilds)) {
      user.guilds = guilds;
      user.guildsAt = Date.now();
      user.guildsOkAt = Date.now();
    }
  } catch {
    user.guildsAt = Date.now(); // keep the saved list and do not hammer Discord
  }
  return user.guilds || [];
}

/** True when the saved list of servers was last confirmed by Discord too long ago (or never since login). */
const isStale = (user, now = Date.now()) => now - (user.guildsOkAt || user.guildsAt || 0) > MAX_STALE;

module.exports = { refreshUserGuilds, isStale, MAX_STALE };
