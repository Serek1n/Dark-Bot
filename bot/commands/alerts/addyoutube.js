const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const axios = require('axios');
const { Alert } = require('../../../db');
const embeds = require('../../utils/embeds');

async function resolveChannelId(handleOrId) {
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(handleOrId)) return handleOrId;

  const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: { key: process.env.YOUTUBE_API_KEY, q: handleOrId, type: 'channel', part: 'snippet', maxResults: 1 }
  });
  return data.items?.[0]?.snippet?.channelId || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addyoutube')
    .setDescription('Подписаться на уведомления о новых видео YouTube-канала')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName('канал').setDescription('ID канала (UC...) или название для поиска').setRequired(true))
    .addChannelOption((opt) => opt.setName('куда_постить').setDescription('Канал Discord для уведомлений').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  async execute(interaction) {
    if (!process.env.YOUTUBE_API_KEY) {
      return interaction.reply({ embeds: [embeds.error('YOUTUBE_API_KEY не настроен на сервере бота.')], ephemeral: true });
    }

    await interaction.deferReply();
    const input = interaction.options.getString('канал');
    const postChannel = interaction.options.getChannel('куда_постить');

    const channelId = await resolveChannelId(input).catch(() => null);
    if (!channelId) {
      return interaction.editReply({ embeds: [embeds.error('YouTube-канал не найден.')] });
    }

    await Alert.upsert({
      guildId: interaction.guild.id,
      channelId: postChannel.id,
      platform: 'youtube',
      targetId: channelId
    });

    await interaction.editReply({ embeds: [embeds.success(`Подписка оформлена. Новые видео будут анонсироваться в <#${postChannel.id}>.`)] });
  }
};
