const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { Alert } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addtwitch')
    .setDescription('Подписаться на уведомления о начале стрима на Twitch')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName('логин').setDescription('Логин Twitch-канала (как в URL twitch.tv/логин)').setRequired(true))
    .addChannelOption((opt) => opt.setName('куда_постить').setDescription('Канал Discord для уведомлений').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  async execute(interaction) {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
      return interaction.reply({ embeds: [embeds.error('TWITCH_CLIENT_ID/SECRET не настроены на сервере бота.')], ephemeral: true });
    }

    const login = interaction.options.getString('логин').toLowerCase();
    const postChannel = interaction.options.getChannel('куда_постить');

    await Alert.upsert({
      guildId: interaction.guild.id,
      channelId: postChannel.id,
      platform: 'twitch',
      targetId: login
    });

    await interaction.reply({ embeds: [embeds.success(`Подписка оформлена. Уведомления о стримах **${login}** будут приходить в <#${postChannel.id}>.`)] });
  }
};
