const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require('@discordjs/voice');
const playdl = require('play-dl');
const logger = require('../../utils/logger');

/**
 * @typedef {{ title: string, url: string, duration: string, requestedBy: string, thumbnail?: string, source: 'youtube'|'soundcloud'|'other' }} Track
 */

class GuildQueue {
  constructor(guildId, voiceChannel, textChannel) {
    this.guildId = guildId;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    /** @type {Track[]} */
    this.tracks = [];
    this.volume = 0.5;
    this.player = createAudioPlayer();
    this.connection = null;
    this.playing = null;
    this._bindPlayerEvents();
  }

  _bindPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playing = null;
      this.playNext().catch((err) => logger.error('playNext error', err));
    });
    this.player.on('error', (err) => {
      logger.error('AudioPlayer error', err);
      this.playing = null;
      this.playNext().catch((e) => logger.error('playNext error', e));
    });
  }

  async connect() {
    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
  }

  enqueue(track) {
    this.tracks.push(track);
  }

  async playNext() {
    if (this.player.state.status !== AudioPlayerStatus.Idle && this.playing) return;
    const next = this.tracks.shift();
    if (!next) {
      this.playing = null;
      return;
    }

    try {
      let stream;
      if (next.source === 'youtube') {
        stream = await playdl.stream(next.url, { discordPlayerCompatibility: true });
      } else if (next.source === 'soundcloud') {
        stream = await playdl.stream(next.url);
      } else {
        stream = await playdl.stream(next.url);
      }
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type || StreamType.Arbitrary,
        inlineVolume: true
      });
      resource.volume?.setVolume(this.volume);
      this.player.play(resource);
      this.playing = next;
      this.textChannel?.send(`▶️ Сейчас играет: **${next.title}** (заказал <@${next.requestedBy}>)`).catch(() => {});
    } catch (err) {
      logger.error('Failed to start track', next.url, err);
      this.textChannel?.send(`⚠️ Не удалось воспроизвести **${next.title}**, пропускаю.`).catch(() => {});
      this.playNext();
    }
  }

  skip() {
    this.player.stop(); // triggers Idle -> playNext
  }

  pause() {
    this.player.pause();
  }

  resume() {
    this.player.unpause();
  }

  setVolume(v) {
    this.volume = v;
    if (this.player.state.status !== 'idle' && this.player.state.resource?.volume) {
      this.player.state.resource.volume.setVolume(v);
    }
  }

  stopAndDestroy() {
    this.tracks = [];
    this.player.stop();
    this.connection?.destroy();
  }
}

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId) || null;
}

function getOrCreateQueue(guildId, voiceChannel, textChannel) {
  let q = queues.get(guildId);
  if (!q) {
    q = new GuildQueue(guildId, voiceChannel, textChannel);
    queues.set(guildId, q);
  }
  return q;
}

function destroyQueue(guildId) {
  const q = queues.get(guildId);
  if (q) {
    q.stopAndDestroy();
    queues.delete(guildId);
  }
}

/**
 * Resolves a search query or URL (YouTube, SoundCloud, Spotify link) into one or more Tracks.
 * Spotify links are resolved by searching YouTube for the same title/artist, since Spotify's
 * API does not provide direct audio streams.
 */
async function resolveQuery(query, requestedBy) {
  const type = await playdl.validate(query).catch(() => false);

  if (type === 'yt_video') {
    const info = await playdl.video_basic_info(query);
    const d = info.video_details;
    return [
      {
        title: d.title,
        url: d.url,
        duration: d.durationRaw,
        thumbnail: d.thumbnails?.[0]?.url,
        requestedBy,
        source: 'youtube'
      }
    ];
  }

  if (type === 'yt_playlist') {
    const playlist = await playdl.playlist_info(query, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos.map((d) => ({
      title: d.title,
      url: d.url,
      duration: d.durationRaw,
      thumbnail: d.thumbnails?.[0]?.url,
      requestedBy,
      source: 'youtube'
    }));
  }

  if (type === 'so_track') {
    const d = await playdl.soundcloud(query);
    return [
      {
        title: d.name,
        url: d.url,
        duration: `${Math.floor(d.durationInSec / 60)}:${String(d.durationInSec % 60).padStart(2, '0')}`,
        thumbnail: d.thumbnail,
        requestedBy,
        source: 'soundcloud'
      }
    ];
  }

  if (type && type.startsWith('sp_')) {
    // Spotify: resolve metadata, then search YouTube for a matching track
    const sp = await playdl.spotify(query);
    const items = sp.type === 'track' ? [sp] : await sp.all_tracks();
    const tracks = [];
    for (const item of items) {
      const searchQuery = `${item.name} ${item.artists?.map((a) => a.name).join(' ') || ''}`;
      const results = await playdl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
      if (results[0]) {
        tracks.push({
          title: `${item.name} — ${item.artists?.[0]?.name || ''}`.trim(),
          url: results[0].url,
          duration: results[0].durationRaw,
          thumbnail: results[0].thumbnails?.[0]?.url,
          requestedBy,
          source: 'youtube'
        });
      }
    }
    return tracks;
  }

  // Fallback: treat as a plain-text search query on YouTube
  const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
  if (!results[0]) return [];
  return [
    {
      title: results[0].title,
      url: results[0].url,
      duration: results[0].durationRaw,
      thumbnail: results[0].thumbnails?.[0]?.url,
      requestedBy,
      source: 'youtube'
    }
  ];
}

module.exports = { getQueue, getOrCreateQueue, destroyQueue, resolveQuery, GuildQueue };
