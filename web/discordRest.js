// One way to call Discord's REST API with the bot's token, for the panel and for the bot's own modules.
//
// With the bot in the same process the call goes through discord.js (client.rest): it knows Discord's rate limits,
// waits when a limit is hit and repeats the request, and shares one queue with everything else the bot does. Without
// the bot (the panel started alone) the same call goes through axios, as before.
//
// The interface is axios's: get(url, config), delete(url, config), post/put/patch(url, body, config), each resolving
// to { data, status }, and an error carries error.response = { status, data } — so callers and tests did not change.
// The reason for the audit log is read from config.headers['X-Audit-Log-Reason'].
const axios = require('axios');
const { getClient } = require('./botBridge');

const API = 'https://discord.com/api/v10';

function axiosClient() {
  return axios.create({ baseURL: API, timeout: 10000, headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } });
}

/** "/guilds/1?with_counts=true" + { params } → the route and its query for discord.js. */
function split(url, params) {
  const [route, q] = String(url).split('?');
  const query = new URLSearchParams(q || '');
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) query.set(k, String(v));
  return { route, query };
}

function reasonOf(config) {
  const raw = config?.headers?.['X-Audit-Log-Reason'] ?? config?.headers?.['x-audit-log-reason'];
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return String(raw); }
}

/** An error of discord.js in the shape the callers read (axios's). */
function asAxiosError(err) {
  if (err?.response) return err;
  const status = err?.status ?? err?.rawError?.status;
  if (status) {
    const e = new Error(err.message || `Discord answered ${status}`);
    e.response = { status, data: err.rawError || { code: typeof err.code === 'number' ? err.code : undefined, message: err.message } };
    e.status = status;
    if (typeof err.code === 'number') e.code = err.code;
    e.cause = err;
    return e;
  }
  return err;
}

function createBotApi() {
  let fallback = null;
  const viaAxios = () => (fallback = fallback || axiosClient());
  async function call(method, url, body, config) {
    const client = getClient();
    if (!client?.rest || typeof client.rest[method] !== 'function') {
      const ax = viaAxios();
      return method === 'get' || method === 'delete' ? ax[method](url, config) : ax[method](url, body, config);
    }
    const { route, query } = split(url, config?.params);
    const options = { query: query.size ? query : undefined, reason: reasonOf(config) };
    if (body !== undefined && body !== null) options.body = body;
    try {
      const data = await client.rest[method](route, options);
      return { data: data === undefined ? null : data, status: 200 };
    } catch (err) {
      throw asAxiosError(err);
    }
  }
  return {
    get: (url, config) => call('get', url, undefined, config),
    delete: (url, config) => call('delete', url, undefined, config),
    post: (url, body, config) => call('post', url, body, config),
    put: (url, body, config) => call('put', url, body, config),
    patch: (url, body, config) => call('patch', url, body, config)
  };
}

module.exports = { createBotApi, split, asAxiosError, API };
