const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Поставить музыку на паузу'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue?.playing) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], ephemeral: true });
    queue.pause();
    await interaction.reply({ embeds: [embeds.success('⏸️ Пауза.')] });
  }
};
