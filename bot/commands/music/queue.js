const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Показать очередь треков'),
  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue || (!queue.playing && !queue.tracks.length)) {
      return interaction.reply({ embeds: [embeds.info('Очередь пуста.')] });
    }

    const lines = [];
    if (queue.playing) lines.push(`▶️ **Сейчас играет:** ${queue.playing.title}`);
    queue.tracks.slice(0, 15).forEach((t, i) => lines.push(`${i + 1}. ${t.title} (${t.duration})`));
    if (queue.tracks.length > 15) lines.push(`…и ещё ${queue.tracks.length - 15} треков`);

    await interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle('🎵 Очередь')] });
  }
};
