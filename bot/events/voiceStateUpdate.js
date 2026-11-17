const { getOrCreateSettings } = require('../modules/leveling');
const { TempVoiceChannel } = require('../../db');
const logger = require('../utils/logger');
const { getQueue, destroyQueue } = require('../modules/music/player');
const { trackVoiceState } = require('../modules/voiceTime');
const { isTempRoom, forgetTempRoom } = require('../modules/tempRooms');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    // Mute / deafen / camera toggles are not channel changes — skip them (saves DB hits and
    // stops a user sitting in the "join to create" channel from spawning duplicate rooms).
    if (oldState.channelId === newState.channelId) return;
    await trackVoiceState(oldState, newState).catch((err) => logger.error('Voice time error:', err));
    const guild = newState.guild || oldState.guild;
    const who = newState.member || oldState.member;
    // achievements: «Алло, слышно?» — the first time in voice
    if (newState.channelId && !oldState.channelId && who && !who.user?.bot) {
      const ch = newState.channel;
      require('../modules/achievements').touch(guild.id, newState.id, { voiceJoin: true, channel: ch && ch.id !== guild.afkChannelId && ch.send ? ch : null });
    }
    if (who) await require('../modules/voiceRoles').syncMember(who, newState.channelId).catch((err) => logger.warn(`Voice roles: ${err.message}`));

    // Music cleanup: the bot itself was moved/kicked out of its channel, or the last
    // listener left it. Without this the old queue lingers and blocks /music play
    // (for example after a temp room is deleted and a new one with the same name is made).
    const musicQueue = getQueue(guild.id);
    if (musicQueue) {
      const botId = guild.client.user?.id;
      const botLeft = newState.id === botId && newState.channelId !== musicQueue.voiceChannel.id;
      let aloneNow = false;
      if (oldState.channelId === musicQueue.voiceChannel.id && newState.id !== botId) {
        const ch = guild.channels.cache.get(musicQueue.voiceChannel.id);
        aloneNow = !ch || ![...ch.members.values()].some((m) => !m.user.bot);
      }
      if (botLeft || aloneNow) destroyQueue(guild.id, 'Все ушли из голосового канала, музыка остановлена.');
    }

    // Clean up an emptied temp channel regardless of whether temp-voice is still
    // configured right now — otherwise disabling the feature leaves old channels stuck.
    if (oldState.channelId) {
      // The ids of the temporary rooms are kept in memory, so leaving an ordinary voice channel costs no database query.
      const tempChannel = (await isTempRoom(oldState.channelId)) ? await TempVoiceChannel.findOne({ where: { channelId: oldState.channelId } }) : null;
      if (tempChannel) {
        const channel = await guild.channels.fetch(oldState.channelId).catch(() => null);
        if (channel && channel.members.size === 0) {
          await channel.delete().catch(() => {});
          await tempChannel.destroy();
          forgetTempRoom(oldState.channelId);
          await require('../modules/voiceRoom').logRoom(guild.id, channel, 'empty', { details: 'пустая комната удалена' });
        } else if (channel && oldState.id === tempChannel.ownerId) {
          // the owner left, the others stay: the room goes on with a new owner
          const s0 = await getOrCreateSettings(guild.id);
          await require('../modules/tempRooms').ownerLeft(guild, tempChannel, channel, s0).catch((err) => logger.warn(`room hand-over: ${err.message}`));
        } else if (!channel) {
          // Channel was already removed some other way (manually deleted) — drop the stale record.
          await tempChannel.destroy();
          forgetTempRoom(oldState.channelId);
        }
      }
    }

    const settings = await getOrCreateSettings(guild.id);
    const { triggerFor, hasTriggers } = require('../utils/voiceTriggers');
    if (!settings?.tempVoiceEnabled || !hasTriggers(settings)) return;

    // User joined a "join to create" channel -> his room (an existing one, or a new one with his saved settings)
    const trigger = triggerFor(settings, newState.channelId);
    if (trigger && newState.member && !newState.member.user?.bot) {
      await require('../modules/tempRooms').createRoomFor(newState, settings, trigger).catch((err) => logger.error('Failed to create temp voice channel:', err));
    }
  }
};
