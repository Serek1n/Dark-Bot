const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Изменить громкость (0-100)')
    .addIntegerOption((opt) => opt.setName('уровень').setDescription('0-100').setRequired(true).setMinValue(0).setMaxValue(100)),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], ephemeral: true });
    const level = interaction.options.getInteger('уровень');
    queue.setVolume(level / 100);
    await interaction.reply({ embeds: [embeds.success(`🔊 Громкость: ${level}%`)] });
  }
};
