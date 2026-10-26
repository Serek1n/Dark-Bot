const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getOrCreateSettings } = require('../modules/leveling');
const { TempVoiceChannel } = require('../../db');
const logger = require('../utils/logger');
const { getQueue, destroyQueue } = require('../modules/music/player');
const { trackVoiceState } = require('../modules/voiceTime');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    // Mute / deafen / camera toggles are not channel changes — skip them (saves DB hits and
    // stops a user sitting in the "join to create" channel from spawning duplicate rooms).
    if (oldState.channelId === newState.channelId) return;
    await trackVoiceState(oldState, newState).catch((err) => logger.error('Voice time error:', err));
    const guild = newState.guild || oldState.guild;

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
      const tempChannel = await TempVoiceChannel.findOne({ where: { channelId: oldState.channelId } });
      if (tempChannel) {
        const channel = await guild.channels.fetch(oldState.channelId).catch(() => null);
        if (channel && channel.members.size === 0) {
          await channel.delete().catch(() => {});
          await tempChannel.destroy();
        } else if (!channel) {
          // Channel was already removed some other way (manually deleted) — drop the stale record.
          await tempChannel.destroy();
        }
      }
    }

    const settings = await getOrCreateSettings(guild.id);
    if (!settings?.tempVoiceJoinChannelId || !settings.tempVoiceEnabled) return;

    // User joined the "join to create" channel -> spawn a new temp channel and move them into it
    if (newState.channelId === settings.tempVoiceJoinChannelId) {
      try {
        const name = settings.tempVoiceNameTemplate.replaceAll('{user}', newState.member.displayName).slice(0, 100) || 'Комната';
        const channel = await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: settings.tempVoiceCategoryId || newState.channel.parentId,
          // The category's rules, plus the owner: he can always see and enter his room, even when he closes it.
          permissionOverwrites: [
            ...(newState.channel.parent?.permissionOverwrites?.cache ? [...newState.channel.parent.permissionOverwrites.cache.values()] : []),
            { id: newState.member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
          ]
        });
        await TempVoiceChannel.create({ guildId: guild.id, channelId: channel.id, ownerId: newState.member.id });
        // The member may already have left the trigger channel: then the new room would stay empty forever.
        const moved = await newState.setChannel(channel).then(() => true).catch(() => false);
        if (!moved) {
          await channel.delete('Владелец вышел до переноса в комнату').catch(() => {});
          await TempVoiceChannel.destroy({ where: { channelId: channel.id } }).catch(() => {});
        }
      } catch (err) {
        logger.error('Failed to create temp voice channel:', err);
      }
    }
  }
};
