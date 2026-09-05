const { ChannelType } = require('discord.js');
const { GuildSettings, TempVoiceChannel } = require('../../db');
const logger = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
    if (!settings?.tempVoiceJoinChannelId) return;

    // User joined the "join to create" channel -> spawn a new temp channel and move them into it
    if (newState.channelId === settings.tempVoiceJoinChannelId) {
      try {
        const name = settings.tempVoiceNameTemplate.replace('{user}', newState.member.displayName);
        const channel = await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: settings.tempVoiceCategoryId || newState.channel.parentId,
          permissionOverwrites: newState.channel.parent?.permissionOverwrites?.cache
            ? [...newState.channel.parent.permissionOverwrites.cache.values()]
            : undefined
        });
        await TempVoiceChannel.create({ guildId: guild.id, channelId: channel.id, ownerId: newState.member.id });
        await newState.setChannel(channel).catch(() => {});
      } catch (err) {
        logger.error('Failed to create temp voice channel:', err);
      }
    }

    // User left a temp channel -> delete it if now empty
    if (oldState.channelId) {
      const tempChannel = await TempVoiceChannel.findOne({ where: { channelId: oldState.channelId } });
      if (tempChannel) {
        const channel = await guild.channels.fetch(oldState.channelId).catch(() => null);
        if (channel && channel.members.size === 0) {
          await channel.delete().catch(() => {});
          await tempChannel.destroy();
        }
      }
    }
  }
};
