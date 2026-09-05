const { SlashCommandBuilder } = require('discord.js');
const { getQueue, getOrCreateQueue, resolveQuery } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Управление музыкой в голосовом канале')
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Включить трек (YouTube/SoundCloud/Spotify-ссылка или поиск)')
        .addStringOption((opt) => opt.setName('запрос').setDescription('Ссылка или название трека').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('skip').setDescription('Пропустить текущий трек'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Остановить и очистить очередь'))
    .addSubcommand((sub) => sub.setName('pause').setDescription('Поставить на паузу'))
    .addSubcommand((sub) => sub.setName('resume').setDescription('Снять с паузы'))
    .addSubcommand((sub) => sub.setName('queue').setDescription('Показать очередь треков'))
    .addSubcommand((sub) =>
      sub
        .setName('volume')
        .setDescription('Установить громкость')
        .addIntegerOption((opt) => opt.setName('процент').setDescription('0-150').setRequired(true).setMinValue(0).setMaxValue(150))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      const query = interaction.options.getString('запрос');
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embeds.error('Зайдите в голосовой канал, чтобы включить музыку.')], ephemeral: true });

      await interaction.deferReply();
      const tracks = await resolveQuery(query, interaction.user.id).catch(() => []);
      if (!tracks.length) return interaction.editReply({ embeds: [embeds.error('Ничего не найдено по запросу.')] });

      const queue = getOrCreateQueue(interaction.guild.id, voiceChannel, interaction.channel);
      if (!queue.connection) await queue.connect();
      tracks.forEach((t) => queue.enqueue(t));
      if (!queue.playing) queue.playNext();

      return interaction.editReply({
        embeds: [embeds.success(tracks.length > 1 ? `Добавлено ${tracks.length} треков в очередь.` : `Добавлено в очередь: **${tracks[0].title}**`)]
      });
    }

    const queue = getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], ephemeral: true });

    if (sub === 'skip') {
      queue.skip();
      return interaction.reply({ embeds: [embeds.success('Трек пропущен.')] });
    }

    if (sub === 'stop') {
      queue.stopAndDestroy();
      return interaction.reply({ embeds: [embeds.success('Воспроизведение остановлено, очередь очищена.')] });
    }

    if (sub === 'pause') {
      queue.pause();
      return interaction.reply({ embeds: [embeds.success('Пауза.')] });
    }

    if (sub === 'resume') {
      queue.resume();
      return interaction.reply({ embeds: [embeds.success('Продолжаю воспроизведение.')] });
    }

    if (sub === 'queue') {
      const lines = [];
      if (queue.playing) lines.push(`▶️ Сейчас играет: **${queue.playing.title}**`);
      queue.tracks.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
      if (!lines.length) return interaction.reply({ embeds: [embeds.info('Очередь пуста.')] });
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle('🎵 Очередь')] });
    }

    if (sub === 'volume') {
      const percent = interaction.options.getInteger('процент');
      queue.setVolume(percent / 100);
      return interaction.reply({ embeds: [embeds.success(`Громкость: ${percent}%`)] });
    }
  }
};
