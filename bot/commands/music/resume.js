const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Возобновить воспроизведение'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], ephemeral: true });
    queue.resume();
    await interaction.reply({ embeds: [embeds.success('▶️ Продолжаю.')] });
  }
};
