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


/**
 * Puts tracks into the server's queue and starts playing when nothing plays: the voice checks, the connection, the
 * queue limit. `playlist` (a DARK playlist) makes "repeat playlist" possible. Answers the (deferred) interaction itself.
 * Returns true when something was queued.
 */
async function enqueueAndPlay(interaction, tracks, { playlist = null, note = '' } = {}) {
  const voiceChannel = interaction.member.voice?.channel;
  const queue = getOrCreateQueue(interaction.guild.id, voiceChannel, interaction.channel);
  if (!queue.connection) {
    try {
      await queue.connect();
    } catch (err) {
      logger.error('Voice connect failed', err);
      destroyQueue(interaction.guild.id);
      await interaction.editReply({ embeds: [embeds.error('Не удалось подключиться к голосовому каналу. Проверьте права бота «Подключаться» и «Говорить».')] });
      return false;
    }
  }
  const wasPlaying = Boolean(queue.playing);
  const room = Math.max(0, MAX_QUEUE - (queue.tracks?.length || 0));
  if (!room) { await interaction.editReply({ embeds: [embeds.error(`Очередь заполнена (${MAX_QUEUE} треков). Дождитесь, пока часть доиграет.`)] }); return false; }
  if (tracks.length > room) tracks = tracks.slice(0, room);
  if (playlist) queue.playlist = playlist; // the latest playlist started is the one "repeat playlist" repeats
  tracks.forEach((t) => queue.enqueue(t));

  if (!wasPlaying) {
    // First track: the control panel (with buttons) becomes this command's reply.
    await queue.playNext(interaction);
    if (!queue.playing) {
      await interaction.editReply({ embeds: [embeds.error('Не удалось воспроизвести трек. Попробуйте другой запрос или ссылку.')] }).catch(() => {});
      return false;
    }
    if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  queue.refreshPanel();
  await interaction.editReply({
    embeds: [embeds.success(`${tracks.length > 1 ? `Добавлено ${tracks.length} треков в очередь.` : `Добавлено в очередь: **${tracks[0].title}**`}${note ? `\n${note}` : ''}`)]
  });
  return true;
}

/** Can this member start music here? Null when yes, else the reply already sent. */
async function voiceGate(interaction) {
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
  return null;
}

/** What a Spotify link gave, in words ("3 трека недоступны и пропущены"). */
function resolveNote(tracks) {
  const m = tracks?.meta;
  if (!m) return '';
  const parts = [];
  if (m.skipped) parts.push(`недоступных в Spotify треков пропущено: ${m.skipped}`);
  if (m.cut) parts.push(`взяты первые ${tracks.length} — остальные ${m.cut} не поместились`);
  return parts.length ? `ℹ️ ${parts.join('; ')}.` : '';
}

const LOOP_TEXT = { off: 'Повтор выключен.', track: '🔂 Повторяю текущий трек.', queue: '🔁 Повторяю всю очередь.', playlist: '🔁 Повторяю плейлист.' };
module.exports = {
  musicRefusal, enqueueAndPlay, voiceGate, searchRefusal, searchDone, resolveNote,
  // Registered as the flat command /play (the grouped `data` below is kept for tests only).
  variants: [
    {
      sub: 'play',
      data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Включить музыку: название трека или ссылка (YouTube, SoundCloud, Spotify, Apple Music)')
        .addStringOption((opt) => opt.setName('query').setDescription('Название или ссылка. Для поиска в SoundCloud: sc: название').setRequired(true).setMaxLength(300))
    },
    {
      sub: 'repeat',
      data: new SlashCommandBuilder()
        .setName('repeat')
        .setDescription('Режим повтора музыки')
        .addStringOption((opt) => opt.setName('mode').setDescription('Что повторять').setRequired(true).addChoices(
          { name: 'Выключить', value: 'off' }, { name: 'Текущий трек', value: 'track' }, { name: 'Всю очередь', value: 'queue' }, { name: 'Плейлист', value: 'playlist' }))
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

    if (sub === 'repeat') {
      const queue = getQueue(interaction.guild.id);
      if (!queue || !queue.playing) return interaction.reply({ embeds: [embeds.error('Сейчас ничего не играет.')], flags: MessageFlags.Ephemeral });
      if (interaction.member.voice?.channelId !== queue.voiceChannel.id) return interaction.reply({ embeds: [embeds.error(`Управлять музыкой можно из голосового канала **${queue.voiceChannel.name}**.`)], flags: MessageFlags.Ephemeral });
      const mode = interaction.options.getString('mode');
      if (!queue.setLoop(mode)) return interaction.reply({ embeds: [embeds.error('Повтор плейлиста включается, когда играет плейлист: /playlist play.')], flags: MessageFlags.Ephemeral });
      queue.refreshPanel();
      return interaction.reply({ embeds: [embeds.success(LOOP_TEXT[mode])] });
    }

    if (sub === 'play') {
      const query = interaction.options.getString('query');
      const gate = await voiceGate(interaction);
      if (gate) return gate;
      // Every search starts a yt-dlp process (a playlist: up to a hundred of them one after another). Without limits
      // a few people sending /play in a row would take the whole machine, and with it the bot on every server.
      const wait = searchRefusal(interaction.guild.id, interaction.user.id);
      if (wait) return interaction.reply({ embeds: [embeds.error(wait)], flags: MessageFlags.Ephemeral });
      await interaction.deferReply();
      let tracks; let failText = null;
      try {
        tracks = await resolveQuery(query, interaction.user.id).catch((err) => {
          logger.error('resolveQuery failed', err);
          failText = err?.userText || null; // Spotify and the like say exactly what is wrong
          return [];
        });
      } finally { searchDone(interaction.guild.id); }
      if (!tracks.length) return interaction.editReply({ embeds: [embeds.error(failText || 'Ничего не найдено по запросу.')] });
      return enqueueAndPlay(interaction, tracks, { note: resolveNote(tracks) });
    }
  }
};
