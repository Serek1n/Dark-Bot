const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getQueue, getOrCreateQueue, destroyQueue, resolveQuery } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

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
    .addSubcommand((sub) => sub.setName('panel').setDescription('Показать панель управления с кнопками заново'))
    .addSubcommand((sub) => sub.setName('queue').setDescription('Показать очередь треков')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      const query = interaction.options.getString('запрос');
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embeds.error('Зайдите в голосовой канал, чтобы включить музыку.')], flags: MessageFlags.Ephemeral });

      const existing = getQueue(interaction.guild.id);
      if (existing && existing.voiceChannel.id !== voiceChannel.id) {
        return interaction.reply({
          embeds: [embeds.error(`Бот уже играет в канале **${existing.voiceChannel.name}**. Зайдите туда или остановите музыку кнопкой ⏹ на панели.`)],
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply();
      const tracks = await resolveQuery(query, interaction.user.id).catch((err) => {
        logger.error('resolveQuery failed', err);
        return [];
      });
      if (!tracks.length) return interaction.editReply({ embeds: [embeds.error('Ничего не найдено по запросу.')] });

      const queue = getOrCreateQueue(interaction.guild.id, voiceChannel, interaction.channel);
      if (!queue.connection) {
        try {
          await queue.connect();
        } catch (err) {
          logger.error('Voice connect failed', err);
          destroyQueue(interaction.guild.id);
          return interaction.editReply({ embeds: [embeds.error('Не удалось подключиться к голосовому каналу. Проверьте права бота «Подключаться» и «Говорить».')] });
        }
      }
      const wasPlaying = Boolean(queue.playing);
      tracks.forEach((t) => queue.enqueue(t));

      if (!wasPlaying) {
        // First track: the control panel (with buttons) becomes this command's reply.
        await queue.playNext(interaction);
        if (!queue.playing) {
          return interaction.editReply({ embeds: [embeds.error('Не удалось воспроизвести трек. Попробуйте другой запрос или ссылку.')] }).catch(() => {});
        }
        return;
      }

      queue.refreshPanel();
      return interaction.editReply({
        embeds: [embeds.success(tracks.length > 1 ? `Добавлено ${tracks.length} треков в очередь.` : `Добавлено в очередь: **${tracks[0].title}**`)]
      });
    }

    const queue = getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], flags: MessageFlags.Ephemeral });

    if (sub === 'panel') {
      const userChannelId = interaction.member.voice?.channelId;
      if (userChannelId !== queue.voiceChannel.id) {
        return interaction.reply({ embeds: [embeds.error('Зайдите в голосовой канал с ботом, чтобы управлять музыкой.')], flags: MessageFlags.Ephemeral });
      }
      if (!queue.playing) return interaction.reply({ embeds: [embeds.info('Сейчас ничего не играет.')], flags: MessageFlags.Ephemeral });
      await interaction.deferReply();
      queue.retirePanel();
      queue.panelMessage = await interaction.editReply(queue.renderPanel()).catch(() => null);
      return;
    }

    if (sub === 'queue') {
      if (!queue.playing && !queue.tracks.length) return interaction.reply({ embeds: [embeds.info('Очередь пуста.')] });

      const embed = embeds.baseEmbed().setTitle('Очередь');
      if (queue.playing) embed.addFields({ name: 'Сейчас играет', value: queue.playing.title });
      if (queue.tracks.length) {
        const lines = queue.tracks.slice(0, 15).map((t, i) => `${i + 1}. ${t.title}`);
        if (queue.tracks.length > 15) lines.push(`…и ещё ${queue.tracks.length - 15}.`);
        embed.addFields({ name: 'Далее', value: lines.join('\n') });
      }
      return interaction.reply({ embeds: [embed] });
    }
  }
};
