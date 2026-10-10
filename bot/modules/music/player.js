const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { renderPanel, renderEnded } = require('./panelView');
const playdl = require('play-dl');
const logger = require('../../utils/logger');

/**
 * @typedef {{ title: string, url: string, duration: string, requestedBy: string, thumbnail?: string, source: 'youtube'|'soundcloud'|'other' }} Track
 */

const IDLE_TIMEOUT_MS = Number(process.env.VOICE_IDLE_MINUTES || 5) * 60 * 1000;
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

/** Spawns yt-dlp and returns { proc, stream } with raw audio on stdout. */
function spawnYtDlpAudio(url) {
  const proc = spawn(
    YTDLP_BIN,
    ['-f', 'bestaudio', '-o', '-', '--quiet', '--no-warnings', '--no-playlist', url],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 2000) stderr = stderr.slice(-2000);
  });
  proc.on('error', (err) => logger.error('yt-dlp spawn error', err));
  proc.on('close', (code) => {
    if (code && code !== 0 && code !== null) logger.warn?.(`yt-dlp exited ${code}: ${stderr.trim()}`);
  });
  return { proc, stream: proc.stdout };
}

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
    this.currentProcess = null;
    this.idleTimer = null;
    this.paused = false;
    this.panelMessage = null; // the message that currently carries the control buttons
    this._bindPlayerEvents();
  }

  _bindPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this._killCurrentProcess();
      this.playing = null;
      this.playNext().catch((err) => logger.error('playNext error', err));
    });
    this.player.on('error', (err) => {
      logger.error('AudioPlayer error', err);
      this._killCurrentProcess();
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
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        destroyQueue(this.guildId); // kicked or moved out: clean up
      }
    });
    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
  }

  renderPanel() {
    return renderPanel({ playing: this.playing, tracks: this.tracks, volume: this.volume, paused: this.paused });
  }

  /** Re-draws the buttons message in place (queue changed, volume changed...). */
  refreshPanel() {
    if (!this.panelMessage || !this.playing) return;
    this.panelMessage.edit(this.renderPanel()).catch(() => {});
  }

  /**
   * Retires the current panel message: buttons removed, optional closing note.
   * Used when a new panel replaces it, or when the session ends.
   */
  retirePanel(text) {
    const msg = this.panelMessage;
    this.panelMessage = null;
    if (!msg) return;
    const payload = text ? renderEnded(text) : { components: [] };
    msg.edit(payload).catch(() => {});
  }

  /**
   * Shows the panel for the track that just started. The first track of a /music play reuses the
   * command's own reply (so the buttons sit right under the command); later tracks post a new
   * message at the bottom of the chat and retire the old one.
   */
  async _showPanel(interaction) {
    const payload = this.renderPanel();
    if (interaction) {
      this.retirePanel();
      this.panelMessage = await interaction.editReply(payload).catch(() => null);
      return;
    }
    this.retirePanel();
    if (this.textChannel) this.panelMessage = await this.textChannel.send(payload).catch(() => null);
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Leaves the voice channel after IDLE_TIMEOUT_MS without music (nothing playing, or paused). */
  _startIdleTimer() {
    this._clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      logger.info?.(`Idle for ${IDLE_TIMEOUT_MS / 60000} min, leaving voice in guild ${this.guildId}`);
      this.textChannel
        ?.send('👋 Никто не слушает уже 5 минут, выхожу из голосового канала.')
        .catch(() => {});
      destroyQueue(this.guildId, 'Бот вышел из голосового канала: музыки не было 5 минут.');
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  _killCurrentProcess() {
    if (this.currentProcess) {
      try { this.currentProcess.kill('SIGKILL'); } catch (_) { /* already gone */ }
      this.currentProcess = null;
    }
  }

  enqueue(track) {
    this.tracks.push(track);
  }

  async playNext(interaction = null) {
    if (this.player.state.status !== AudioPlayerStatus.Idle && this.playing) return;
    const next = this.tracks.shift();
    if (!next) {
      this.playing = null;
      this.paused = false;
      this.retirePanel('Очередь закончилась. Добавьте трек через `/music play`.');
      this._startIdleTimer();
      return;
    }
    this._clearIdleTimer();

    try {
      let resource;
      if (next.source === 'youtube') {
        const { proc, stream } = spawnYtDlpAudio(next.url);
        this.currentProcess = proc;
        resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true
        });
      } else {
        const stream = await playdl.stream(next.url);
        resource = createAudioResource(stream.stream, {
          inputType: stream.type || StreamType.Arbitrary,
          inlineVolume: true
        });
      }
      resource.volume?.setVolume(this.volume);
      this.player.play(resource);
      this.playing = next;

      this.paused = false;
      await this._showPanel(interaction);
    } catch (err) {
      this._killCurrentProcess();
      logger.error('Failed to start track', next.url, err);
      this.textChannel?.send(`⚠️ Не удалось воспроизвести **${next.title}**, пропускаю.`).catch(() => {});
      this.playNext(interaction);
    }
  }

  skip() {
    this.player.stop(true); // triggers Idle -> playNext
  }

  pause() {
    this.player.pause();
    this.paused = true;
    this._startIdleTimer();
  }

  resume() {
    this.player.unpause();
    this.paused = false;
    this._clearIdleTimer();
  }

  setVolume(v) {
    this.volume = v;
    if (this.player.state.status !== 'idle' && this.player.state.resource?.volume) {
      this.player.state.resource.volume.setVolume(v);
    }
  }

  stopAndDestroy(note = 'Воспроизведение остановлено.') {
    this._clearIdleTimer();
    this.retirePanel(note);
    this.tracks = [];
    this.player.stop();
    this._killCurrentProcess();
    try { this.connection?.destroy(); } catch (_) { /* already destroyed */ }
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

function destroyQueue(guildId, note) {
  const q = queues.get(guildId);
  if (q) {
    queues.delete(guildId);
    q.stopAndDestroy(note);
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
