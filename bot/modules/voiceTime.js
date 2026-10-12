const { MemberProfile } = require('../../db');
const logger = require('../utils/logger');
const { GuildSettings } = require('../../db');
const { grantVoiceXp } = require('./leveling');
const { announceLevelUp } = require('../utils/levelUp');
const { applyLevelRoles } = require('./levelRoles');

// userId+guildId -> timestamp (ms) when the current counting window started.
const sessions = new Map();
const FLUSH_MS = 5 * 60 * 1000;
const XP_TICK_MS = 60 * 1000;
const key = (guildId, userId) => `${guildId}:${userId}`;

async function addSeconds(guildId, userId, seconds) {
  if (seconds <= 0) return;
  const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
  profile.voiceSeconds = Number(profile.voiceSeconds || 0) + seconds;
  await profile.save();
}

function startSession(guildId, userId) {
  if (!sessions.has(key(guildId, userId))) sessions.set(key(guildId, userId), Date.now());
}

async function endSession(guildId, userId) {
  const k = key(guildId, userId);
  const started = sessions.get(k);
  if (started === undefined) return;
  sessions.delete(k);
  await addSeconds(guildId, userId, Math.floor((Date.now() - started) / 1000));
}

/** Handles join / leave / move for one voiceStateUpdate. Bots and the AFK channel are not counted. */
async function trackVoiceState(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return;
  const guild = newState.guild || oldState.guild;
  const afk = guild.afkChannelId;
  const inNow = newState.channelId && newState.channelId !== afk;
  const wasIn = oldState.channelId && oldState.channelId !== afk;
  if (wasIn && !inNow) await endSession(guild.id, member.id);
  else if (!wasIn && inNow) startSession(guild.id, member.id);
}

/** On startup: start counting for everyone who is already sitting in voice. */
function seedFromGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || state.channelId === guild.afkChannelId || state.member?.user?.bot) continue;
      startSession(guild.id, state.id);
    }
  }
  const timer = setInterval(() => flushAll().catch((err) => logger.error('voice flush failed', err)), FLUSH_MS);
  timer.unref?.();
  const xpTimer = setInterval(() => xpTick(client).catch((err) => logger.error('voice xp tick failed', err)), XP_TICK_MS);
  xpTimer.unref?.();
}

/**
 * Once a minute: everyone sitting in a voice channel gets voice XP and coins. Not counted: bots,
 * the AFK channel, deafened members and channels with fewer people than "voiceMinMembers"
 * (default 2, so nobody farms by sitting alone).
 */
async function xpTick(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
    if (!settings || !settings.levelingEnabled || !settings.voiceEnabled) continue;
    const xpPerMinute = Math.max(0, Number(settings.voiceXpPerMinute) || 0);
    if (!(xpPerMinute > 0) && !(Number(settings.voiceCoinsPerMinute) > 0)) continue;
    const minMembers = Math.max(1, Number(settings.voiceMinMembers) || 2);
    const announceChannel = settings.levelUpChannelId ? guild.channels.cache.get(settings.levelUpChannelId) : null;

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      const humans = [...channel.members.values()].filter((m) => !m.user.bot);
      if (humans.length < minMembers) continue;
      for (const member of humans) {
        if (member.voice?.deaf) continue;
        const result = await grantVoiceXp(guild.id, member.id, xpPerMinute).catch(() => null);
        if (result) await applyLevelRoles(member, result.levels, settings.levelRolesReplace);
        if (result?.leveledUp) {
          await announceLevelUp({
            guild,
            user: member.user,
            displayName: member.displayName,
            level: result.newLevel,
            channel: announceChannel,
            crystals: result.crystals,
            crystalName: settings.crystalName
          });
        }
      }
    }
  }
}

/** Saves time of everyone currently in voice and restarts their windows (so a restart loses < 5 min). */
async function flushAll() {
  const now = Date.now();
  for (const [k, started] of [...sessions]) {
    const [guildId, userId] = k.split(':');
    sessions.set(k, now);
    await addSeconds(guildId, userId, Math.floor((now - started) / 1000));
  }
}

/** Live (unsaved) seconds of a currently connected member, to show up-to-date numbers. */
function pendingSeconds(guildId, userId) {
  const started = sessions.get(key(guildId, userId));
  return started === undefined ? 0 : Math.floor((Date.now() - started) / 1000);
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  if (h) return `${h} ч`; // total hours, no days
  return `${Math.floor(s / 60)} мин`;
}

module.exports = { xpTick, trackVoiceState, seedFromGuilds, flushAll, pendingSeconds, formatDuration, sessions };
