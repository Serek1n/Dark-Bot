const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getQueue, getOrCreateQueue, destroyQueue, resolveQuery } = require('../../modules/music/player');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

/** Why the bot cannot play in this voice channel (missing rights, the channel is full), or null. */
function musicRefusal(channel, me) {
  if (!channel || !me) return null;
  const { missingIn } = require('../../utils/missingPermissions');
  const { name } = require('../../utils/permissionNames');
  const missing = missingIn(channel, me, ['ViewChannel', 'Connect', 'Speak']);
  if (missing.length) return `Бот не может играть в канале **${channel.name}**: не хватает прав ${missing.map((p) => `«${name(p)}»`).join(', ')}. Выдайте их роли бота в настройках этого канала.`;
  const full = channel.userLimit && channel.members?.size >= channel.userLimit && !channel.members.has(me.id);
  if (full && missingIn(channel, me, ['MoveMembers']).length) return `Канал **${channel.name}** заполнен (${channel.userLimit} из ${channel.userLimit}) — бот не может в него зайти.`;
  return null;
}

const PLAY_COOLDOWN = 4000; // per member
const MAX_SEARCHES_GUILD = 2; // running at once on one server
const MAX_SEARCHES_ALL = 6; // running at once in the whole bot
const MAX_QUEUE = 500; // tracks waiting on one server
const lastPlay = new Map(); const searching = new Map(); let searchingAll = 0;
function searchRefusal(guildId, userId) {
  const now = Date.now();
  const last = lastPlay.get(userId) || 0;
  if (now - last < PLAY_COOLDOWN) return 'Слишком часто. Подождите пару секунд и повторите.';
  if ((searching.get(guildId) || 0) >= MAX_SEARCHES_GUILD || searchingAll >= MAX_SEARCHES_ALL) return 'Сейчас уже идёт поиск других треков. Повторите через несколько секунд.';
  if (lastPlay.size > 5000) for (const [k, t] of lastPlay) if (now - t > PLAY_COOLDOWN) lastPlay.delete(k);
  lastPlay.set(userId, now);
  searching.set(guildId, (searching.get(guildId) || 0) + 1); searchingAll++;
  return null;
}
function searchDone(guildId) {
  const n = (searching.get(guildId) || 1) - 1;
  if (n > 0) searching.set(guildId, n); else searching.delete(guildId);
  searchingAll = Math.max(0, searchingAll - 1);
}

module.exports = {
  musicRefusal,
  // Registered as the flat command /play (the grouped `data` below is kept for tests only).
  variants: [
    {
      sub: 'play',
      data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Включить музыку: название трека или ссылка (YouTube, SoundCloud, Spotify, Apple Music)')
        .addStringOption((opt) => opt.setName('query').setDescription('Название или ссылка. Для поиска в SoundCloud: sc: название').setRequired(true).setMaxLength(300))
    }
  ],
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Управление музыкой в голосовом канале')
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Включить трек (YouTube/SoundCloud/Spotify/Apple Music-ссылка или поиск)')
        .addStringOption((opt) => opt.setName('query').setDescription('Ссылка или название трека').setRequired(true).setMaxLength(300))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      const query = interaction.options.getString('query');
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embeds.error('Зайдите в голосовой канал, чтобы включить музыку.')], flags: MessageFlags.Ephemeral });

      let existing = getQueue(interaction.guild.id);
      // The bot was kicked/moved out of voice but the queue is still stored: drop the stale session.
      const me = interaction.guild.members?.me;
      if (existing && ((me?.voice && me.voice.channelId !== existing.voiceChannel.id) || !interaction.guild.channels.cache.has(existing.voiceChannel.id))) {
        destroyQueue(interaction.guild.id);
        existing = null;
      }
      if (existing && existing.voiceChannel.id !== voiceChannel.id) {
        return interaction.reply({
          embeds: [embeds.error(`Бот уже играет в канале **${existing.voiceChannel.name}**. Зайдите туда или остановите музыку кнопкой ⏹ на панели.`)],
          flags: MessageFlags.Ephemeral
        });
      }

      // Check the voice channel BEFORE searching and joining: without these rights joining just hangs and the person waits for nothing.
      const voiceRefusal = musicRefusal(voiceChannel, interaction.guild.members?.me);
      if (voiceRefusal) return interaction.reply({ embeds: [embeds.error(voiceRefusal)], flags: MessageFlags.Ephemeral });

      // Every search starts a yt-dlp process (a playlist: up to a hundred of them one after another). Without limits
      // a few people sending /play in a row would take the whole machine, and with it the bot on every server.
      const wait = searchRefusal(interaction.guild.id, interaction.user.id);
      if (wait) return interaction.reply({ embeds: [embeds.error(wait)], flags: MessageFlags.Ephemeral });
      await interaction.deferReply();
      let tracks;
      try {
        tracks = await resolveQuery(query, interaction.user.id).catch((err) => {
          logger.error('resolveQuery failed', err);
          return [];
        });
      } finally { searchDone(interaction.guild.id); }
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
      const room = Math.max(0, MAX_QUEUE - (queue.tracks?.length || 0));
      if (!room) return interaction.editReply({ embeds: [embeds.error(`Очередь заполнена (${MAX_QUEUE} треков). Дождитесь, пока часть доиграет.`)] });
      if (tracks.length > room) tracks = tracks.slice(0, room);
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
