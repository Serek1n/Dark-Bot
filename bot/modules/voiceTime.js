const { sequelize } = require('../../db');
const logger = require('../utils/logger');
const { grantVoiceXpBatch, getOrCreateSettings, boostFor } = require('./leveling');
const { announceLevelUp, levelUpTarget } = require('../utils/levelUp');
const { applyLevelRoles } = require('./levelRoles');

// userId+guildId -> timestamp (ms) when the current counting window started.
const sessions = new Map();
const FLUSH_MS = 5 * 60 * 1000;
const XP_TICK_MS = 60 * 1000;
const key = (guildId, userId) => `${guildId}:${userId}`;

/**
 * Adds seconds to many members in ONE transaction with plain SQL increments (atomic, no
 * read-modify-write). entries: [[guildId, userId, seconds], ...]. Members without a profile get one.
 */
async function addSecondsBatch(entries) {
  const rows = entries.filter(([, , sec]) => sec > 0);
  const now = new Date();
  // One multi-row statement per 200 members: insert, or add to the existing total (atomic).
  for (let i = 0; i < rows.length; i += 200) {
    const group = rows.slice(i, i + 200);
    await sequelize.query(
      `INSERT INTO member_profiles (guildId, userId, voiceSeconds, createdAt, updatedAt) VALUES ${group.map(() => '(?, ?, ?, ?, ?)').join(',')}
       ON CONFLICT (guildId, userId) DO UPDATE SET voiceSeconds = COALESCE(member_profiles.voiceSeconds, 0) + excluded.voiceSeconds, updatedAt = excluded.updatedAt`,
      { replacements: group.flatMap(([guildId, userId, seconds]) => [guildId, userId, seconds, now, now]) }
    );
  }
}

const addSeconds = (guildId, userId, seconds) => addSecondsBatch([[guildId, userId, seconds]]);

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

const isMuted = (m) => Boolean(m.voice?.deaf || m.voice?.mute || m.voice?.selfDeaf || m.voice?.selfMute);

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
  const timer = setInterval(() => flushAll(client).catch((err) => logger.error('voice flush failed', err)), FLUSH_MS);
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
    const settings = await getOrCreateSettings(guild.id);
    if (!settings || !settings.levelingEnabled || !settings.voiceEnabled) continue;
    const xpPerMinute = Math.max(0, Number(settings.voiceXpPerMinute) || 0);
    if (!(xpPerMinute > 0) && !(Number(settings.voiceCoinsPerMinute) > 0)) continue;
    const minMembers = Math.max(1, Number(settings.voiceMinMembers) || 2);
    const skipMuted = settings.voiceSkipMuted !== false && settings.voiceSkipMuted !== 0;

    // Everyone who earns this minute, across all voice channels of the server, grouped by the bonus of
    // their channel (a channel or its category can pay more XP and coins, or nothing).
    const groups = new Map(); // "xpMultiplier|coinMultiplier" -> { xp, coins, members: [] }
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      // With "skip muted" on (the default) a member with the microphone or the sound switched off is neither company for the others nor paid:
      // one real person plus a muted second account would otherwise farm voice income for free.
      const humans = [...channel.members.values()].filter((m) => !m.user.bot && !(skipMuted && isMuted(m)));
      if (humans.length < minMembers) continue;
      const boost = boostFor(settings, [channel.id, channel.parentId]);
      if (boost.xp === 0 && boost.coins === 0) continue;
      const k = `${boost.xp}|${boost.coins}`;
      if (!groups.has(k)) groups.set(k, { ...boost, members: [] });
      for (const member of humans) if (!member.voice?.deaf) groups.get(k).members.push(member);
    }

    for (const { xp, coins, members: earners } of groups.values()) {
      // 200 members at a time: one database round trip for each group instead of one per member.
      for (let i = 0; i < earners.length; i += 200) {
        const group = earners.slice(i, i + 200);
        const results = await grantVoiceXpBatch(guild.id, group.map((m) => m.id), Math.round(xpPerMinute * xp), coins).catch((err) => {
          logger.error('voice xp batch failed', err);
          return new Map();
        });
        for (const member of group) {
          const result = results.get(member.id);
          if (!result) continue;
          await applyLevelRoles(member, result.levels, settings.levelRolesReplace);
          if (result.leveledUp) {
            // The member is in a voice channel right now: the message goes to that channel's chat.
            const { channel, fallback } = await levelUpTarget({ guild, member, settings });
            await announceLevelUp({
              guild,
              user: member.user,
              displayName: member.displayName,
              level: result.newLevel,
              channel,
              fallback,
              crystals: result.crystals,
              crystalName: settings.crystalName
            });
          }
        }
      }
    }
  }
}

/** Saves time of everyone currently in voice and restarts their windows (so a restart loses < 5 min). */
async function flushAll(client = null) {
  const now = Date.now();
  const entries = [];
  for (const [k, started] of [...sessions]) {
    const [guildId, userId] = k.split(':');
    // A missed "left voice" event (gateway reconnect, the bot removed from the server) must not count forever:
    // whoever is no longer in a voice channel gets this last window and the session is closed.
    const guild = client?.guilds?.cache?.get(guildId);
    const stillIn = !client || Boolean(guild?.voiceStates?.cache?.get(userId)?.channelId);
    if (stillIn) sessions.set(k, now);
    else sessions.delete(k);
    entries.push([guildId, userId, Math.floor((now - started) / 1000)]);
  }
  await addSecondsBatch(entries);
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
