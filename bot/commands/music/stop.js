const { SlashCommandBuilder } = require('discord.js');
const { destroyQueue, getQueue } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Остановить музыку и очистить очередь'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], ephemeral: true });
    destroyQueue(interaction.guild.id);
    await interaction.reply({ embeds: [embeds.success('Музыка остановлена, очередь очищена.')] });
  }
};
