const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateQueue, resolveQuery } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Включить музыку (YouTube, SoundCloud, Spotify-ссылка или поиск)')
    .addStringOption((opt) => opt.setName('запрос').setDescription('Ссылка или название трека').setRequired(true)),
  async execute(interaction) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ embeds: [embeds.error('Сначала зайдите в голосовой канал.')], ephemeral: true });
    }

    await interaction.deferReply();
    const query = interaction.options.getString('запрос');

    let tracks;
    try {
      tracks = await resolveQuery(query, interaction.user.id);
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`Не удалось найти трек: ${err.message}`)] });
    }

    if (!tracks.length) {
      return interaction.editReply({ embeds: [embeds.error('Ничего не найдено.')] });
    }

    const queue = getOrCreateQueue(interaction.guild.id, voiceChannel, interaction.channel);
    if (!queue.connection) await queue.connect();

    for (const track of tracks) queue.enqueue(track);
    if (!queue.playing) queue.playNext();

    const label = tracks.length === 1 ? `**${tracks[0].title}**` : `плейлист из ${tracks.length} треков`;
    await interaction.editReply({ embeds: [embeds.success(`Добавлено в очередь: ${label}`)] });
  }
};
