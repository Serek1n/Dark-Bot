// Can the bot actually work in a channel picked in the panel? Without this a log channel the bot cannot see is saved
// silently and the logs just never arrive. Permissions are counted the way Discord counts them: server roles, then the
// channel's overwrites (@everyone, roles, the bot itself). The answer is the list of what is missing, by short codes.
const { PermissionFlagsBits: P } = require('discord.js');
const { getClient } = require('../botBridge');

const FLAGS = {
  view: P.ViewChannel, send: P.SendMessages, embed: P.EmbedLinks, history: P.ReadMessageHistory, react: P.AddReactions,
  connect: P.Connect, manage: P.ManageChannels, move: P.MoveMembers, webhooks: P.ManageWebhooks, files: P.AttachFiles
};
// What each kind of channel setting needs from the bot.
const NEEDS = {
  post: ['view', 'send', 'embed'], // logs, greetings, level-ups, reports, alerts
  card: ['view', 'send', 'embed', 'files'], // greetings with a picture card
  react: ['view', 'history', 'react'], // reaction roles
  voice: ['view', 'connect', 'manage', 'move'] // "join to create" channel of temporary rooms
};

function permsFromRest(guildId, guild, me, channel) {
  const roles = new Map((guild.roles || []).map((r) => [r.id, BigInt(r.permissions || 0)]));
  if (guild.owner_id === me.user?.id) return null; // the owner may do everything
  let perms = roles.get(guildId) || 0n;
  for (const id of me.roles || []) perms |= roles.get(id) || 0n;
  if (perms & P.Administrator) return null;
  const ow = channel.permission_overwrites || [];
  const apply = (o) => { if (o) perms = (perms & ~BigInt(o.deny || 0)) | BigInt(o.allow || 0); };
  apply(ow.find((o) => o.id === guildId));
  let deny = 0n, allow = 0n;
  for (const o of ow) if (o.type === 0 && o.id !== guildId && (me.roles || []).includes(o.id)) { deny |= BigInt(o.deny || 0); allow |= BigInt(o.allow || 0); }
  perms = (perms & ~deny) | allow;
  apply(ow.find((o) => o.type === 1 && o.id === me.user?.id));
  return perms;
}

/**
 * Returns { missing(channelId, need) → null (all fine) | ['view', 'send', …] | ['gone'] }.
 * If Discord cannot be asked, nothing is refused: this is a hint against mistakes, not a lock.
 */
async function channelGuard(guildId) {
  const guild = getClient()?.guilds.cache.get(guildId);
  if (guild && guild.members.me) {
    return {
      missing(channelId, need = 'post') {
        const channel = guild.channels.cache.get(String(channelId));
        if (!channel) return ['gone'];
        const perms = channel.permissionsFor(guild.members.me);
        if (!perms) return null;
        const miss = (NEEDS[need] || NEEDS.post).filter((k) => !perms.has(FLAGS[k]));
        return miss.length ? miss : null;
      }
    };
  }
  try {
    const { botApi } = require('../discordApi');
    const get = (url) => botApi.get(url).then((r) => r.data);
    const [g, me, channels] = await Promise.all([get(`/guilds/${guildId}`), get(`/guilds/${guildId}/members/${process.env.DISCORD_CLIENT_ID}`), get(`/guilds/${guildId}/channels`)]);
    const byId = new Map(channels.map((c) => [c.id, c]));
    return {
      missing(channelId, need = 'post') {
        const channel = byId.get(String(channelId));
        if (!channel) return ['gone'];
        const perms = permsFromRest(guildId, g, me, channel);
        if (perms === null) return null;
        const miss = (NEEDS[need] || NEEDS.post).filter((k) => !(perms & FLAGS[k]));
        return miss.length ? miss : null;
      }
    };
  } catch {
    return { missing: () => null };
  }
}

/**
 * Takes channel fields from a settings form. A field that changed to a channel the bot cannot work in keeps its old value;
 * the codes of what is missing are returned for the message on the page. Example: pickChannels(req.body, settings, guildId,
 * { modLogChannelId: 'post' }).
 */
async function pickChannels(body, settings, guildId, fields) {
  const { snowflake } = require('./common');
  let guard = null; const missing = new Set();
  for (const [field, need] of Object.entries(fields)) {
    const id = snowflake(body[field]);
    if (id && id !== settings[field]) {
      guard = guard || await channelGuard(guildId);
      const miss = guard.missing(id, need);
      if (miss) { miss.forEach((m) => missing.add(m)); continue; }
    }
    settings[field] = id;
  }
  return [...missing];
}

/** The page address that shows "the bot lacks …" over the page. */
const noPerm = (guildId, page, missing, hash = '') => `/dashboard/${guildId}/${page}?noperm=1&need=${encodeURIComponent(missing.join(','))}${hash}`;

module.exports = { channelGuard, pickChannels, noPerm, NEEDS, permsFromRest };
