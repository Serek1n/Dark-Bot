const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { GuildSettings } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Пожаловаться на сообщение').setType(ApplicationCommandType.Message),
  async execute(interaction) {
    const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
    if (!settings?.reportChannelId) {
      return interaction.reply({ embeds: [embeds.error('Канал для жалоб не настроен. Обратитесь к администрации или настройте его в веб-панели.')], ephemeral: true });
    }

    const channel = await interaction.guild.channels.fetch(settings.reportChannelId).catch(() => null);
    if (!channel) {
      return interaction.reply({ embeds: [embeds.error('Канал для жалоб недоступен.')], ephemeral: true });
    }

    const message = interaction.targetMessage;
    const embed = embeds
      .baseEmbed(0xfee75c)
      .setTitle('🚩 Новая жалоба')
      .addFields(
        { name: 'От', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'На', value: `<@${message.author.id}>`, inline: true },
        { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
        { name: 'Содержание', value: message.content?.slice(0, 1000) || '*(вложение/embed без текста)*' },
        { name: 'Ссылка', value: message.url }
      );

    await channel.send({ embeds: [embed] });
    await interaction.reply({ embeds: [embeds.success('Жалоба отправлена модераторам.')], ephemeral: true });
  }
};
