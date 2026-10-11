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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      const query = interaction.options.getString('запрос');
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embeds.error('Зайдите в голосовой канал, чтобы включить музыку.')], flags: MessageFlags.Ephemeral });

      let existing = getQueue(interaction.guild.id);
      // The bot was kicked/moved out of voice but the queue is still stored: drop the stale session.
      const me = interaction.guild.members?.me;
      if (existing && me?.voice && !me.voice.channelId) {
        destroyQueue(interaction.guild.id);
        existing = null;
      }
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
  }
};
