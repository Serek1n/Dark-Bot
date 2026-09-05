const { SlashCommandBuilder } = require('discord.js');
const { Alert } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('listalerts').setDescription('Показать все подписки на оповещения'),
  async execute(interaction) {
    const alerts = await Alert.findAll({ where: { guildId: interaction.guild.id } });
    if (!alerts.length) return interaction.reply({ embeds: [embeds.info('Подписок пока нет.')] });

    const lines = alerts.map((a) => `${a.platform === 'youtube' ? '📺' : '🟣'} **${a.targetName || a.targetId}** → <#${a.channelId}>`);
    await interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle('🔔 Оповещения')] });
  }
};
