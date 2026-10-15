const fs = require('fs');
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

/**
 * Options for every yt-dlp call, from the .env file (read on each call):
 *  YTDLP_COOKIES    path to a cookies.txt of a YouTube account: age-restricted videos and "confirm you're not a bot"
 *  YTDLP_EXTRA_ARGS any extra yt-dlp options, e.g. "--js-runtimes node" (new yt-dlp versions need a JS runtime for YouTube)
 */
function ytDlpBaseArgs() {
  const args = [];
  const cookies = (process.env.YTDLP_COOKIES || '').trim();
  if (cookies && fs.existsSync(cookies)) args.push('--cookies', cookies);
  const extra = (process.env.YTDLP_EXTRA_ARGS || '').trim();
  if (extra) args.push(...extra.split(/\s+/));
  return args;
}

/** Why yt-dlp failed, in words for the chat (null when the reason is not recognised). */
function ytDlpFailReason(stderr) {
  const t = String(stderr || '');
  if (/confirm your age|age-restricted|inappropriate for some users/i.test(t)) return 'видео с возрастным ограничением: нужен вход в YouTube (файл cookies)';
  if (/not a bot/i.test(t)) return 'YouTube просит подтвердить, что это не бот (нужен файл cookies или другой IP сервера)';
  if (/HTTP Error 403|Forbidden/i.test(t)) return 'YouTube отклонил загрузку (ошибка 403): обновите yt-dlp или добавьте cookies';
  if (/Private video|Video unavailable|removed|not available in your country|blocked/i.test(t)) return 'видео недоступно (приватное, удалено или закрыто для региона)';
  if (/Requested format is not available|n challenge|JavaScript runtime|nsig/i.test(t)) return 'yt-dlp не смог разобрать YouTube: обновите его и включите JS-рантайм (`--js-runtimes node`)';
  if (/ENOENT|not found/i.test(t)) return 'не найден yt-dlp на сервере';
  return null;
}

/** Spawns yt-dlp and returns { proc, stream } with raw audio on stdout. */
function ytDlpAudioArgs(url) {
  // SoundCloud offers a plain mp3 over HTTP next to its HLS streams: take that first, it needs nothing extra.
  const format = /soundcloud\.com|snd\.sc/i.test(String(url)) ? 'http_mp3_1_0/http_mp3/bestaudio/best' : 'bestaudio';
  return [...ytDlpBaseArgs(), '-f', format, '-o', '-', '--quiet', '--no-warnings', '--no-playlist', url];
}

function spawnYtDlpAudio(url, onFail = null) {
  const proc = spawn(YTDLP_BIN, ytDlpAudioArgs(url), { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let gotAudio = false;
  proc.stdout.once('data', () => { gotAudio = true; });
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 2000) stderr = stderr.slice(-2000);
  });
  proc.on('error', (err) => logger.error('yt-dlp spawn error', err));
  proc.on('close', (code) => {
    if (code && code !== 0 && code !== null) {
      logger.warn(`yt-dlp exited ${code}: ${stderr.trim()}`);
      if (!gotAudio && onFail) onFail(ytDlpFailReason(stderr)); // nothing was played: tell the chat why
    }
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
    /** Tracks that already played (most recent last), for the "previous" button. */
    this.history = [];
    this._skipHistory = false;
    this.panelMessage = null; // the message that currently carries the control buttons
    this._bindPlayerEvents();
  }

  _bindPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this._killCurrentProcess();
      // Remember what just played, so the "previous" button can bring it back
      // (not when it was re-queued by "previous" itself).
      if (this.playing && !this._skipHistory) {
        this.history.push(this.playing);
        if (this.history.length > 25) this.history.shift();
      }
      this._skipHistory = false;
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
    // Joining a voice channel sometimes hangs in "signalling"; a fresh attempt usually works.
    // Every state change is logged so a stuck connection can be diagnosed from `pm2 logs`.
    const attempts = 2;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const conn = joinVoiceChannel({
        channelId: this.voiceChannel.id,
        guildId: this.guildId,
        adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true
      });
      this.connection = conn;
      conn.on('stateChange', (oldS, newS) => {
        const code = newS.closeCode ? ` closeCode=${newS.closeCode}` : '';
        logger.info(`Voice[${this.guildId}] ${oldS.status} -> ${newS.status}${code}`);
      });
      conn.on('error', (err) => logger.error(`Voice[${this.guildId}] error: ${err.message}`));
      conn.on(VoiceConnectionStatus.Disconnected, async () => {
        if (this.connection !== conn) return; // an older attempt that was replaced
        try {
          await Promise.race([
            entersState(conn, VoiceConnectionStatus.Signalling, 5000),
            entersState(conn, VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch {
          destroyQueue(this.guildId); // kicked or moved out: clean up
        }
      });
      conn.subscribe(this.player);
      try {
        await entersState(conn, VoiceConnectionStatus.Ready, 12000);
        return;
      } catch (err) {
        lastError = err;
        logger.warn(`Voice[${this.guildId}] attempt ${attempt}/${attempts} did not become ready (stuck in "${conn.state.status}")`);
        this.connection = null;
        try { conn.destroy(); } catch { /* already destroyed */ }
      }
    }
    throw lastError;
  }

  renderPanel() {
    return renderPanel({ playing: this.playing, tracks: this.tracks, volume: this.volume, paused: this.paused, canBack: this.history.length > 0 });
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
   * Shows the panel for the track that just started. The first track of a /play reuses the
   * command's own reply (so the buttons sit right under the command); later tracks post a new
   * message at the bottom of the chat and retire the old one.
   */
  async _showPanel(interaction) {
    const payload = this.renderPanel();
    if (interaction) {
      this.retirePanel();
      this.panelMessage = await interaction.editReply(payload).catch((err) => {
        logger.error('Could not show the music panel:', err);
        return null;
      });
      if (!this.panelMessage) {
        // Never leave "Dark is thinking…" hanging: say at least what is playing.
        await interaction.editReply({ content: `▶ Играет: **${this.playing?.title || 'трек'}**`, embeds: [], components: [] }).catch(() => {});
      }
      return;
    }
    const previous = this.panelMessage;
    let fresh = null;
    if (this.textChannel) {
      fresh = await this.textChannel.send(payload).catch((err) => {
        logger.warn?.(`Could not post the music panel (missing Send Messages / Embed Links?): ${err.message}`);
        return null;
      });
    }
    if (fresh) {
      this.retirePanel();
      this.panelMessage = fresh;
    } else if (previous) {
      // Posting a new message failed: keep the buttons by updating the old panel in place.
      this.panelMessage = (await previous.edit(payload).catch(() => null)) || previous;
    }
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
      this.retirePanel('Очередь закончилась. Добавьте трек через `/play`.');
      this._startIdleTimer();
      return;
    }
    this._clearIdleTimer();
    try {
      let resource;
      if (next.source === 'youtube' || next.source === 'soundcloud') {
        // Both go through yt-dlp: it keeps up with the sites, play-dl's SoundCloud needs a key that expires.
        const { proc, stream } = spawnYtDlpAudio(next.url, (reason) =>
          this.textChannel?.send(`⚠️ Не удалось воспроизвести **${next.title}**${reason ? ': ' + reason : ''}.`).catch(() => {})
        );
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

  /** Plays the previous track again (the current one is queued right after it). Returns false if there is none. */
  back() {
    const prev = this.history.pop();
    if (!prev) return false;
    if (this.playing) this.tracks.unshift(this.playing);
    this.tracks.unshift(prev);
    this._skipHistory = true; // the current track was put back in the queue, not "finished"
    this.player.stop(true);
    return true;
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
// ---- fast metadata lookup -------------------------------------------------------------
// play-dl scrapes YouTube itself and is often slow or broken on servers; yt-dlp (already needed for
// playback and kept up to date) answers a search in a second or two. play-dl stays as a fallback.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: нет ответа за ${Math.round(ms / 1000)} с`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function ytDlpJson(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [...ytDlpBaseArgs(), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('yt-dlp: нет ответа за ' + Math.round(timeoutMs / 1000) + ' с'));
    }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('yt-dlp: непонятный ответ')); }
    });
  });
}

function formatSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function trackFromYtDlp(e, requestedBy) {
  const id = e.id;
  return {
    title: e.title,
    url: e.webpage_url || (e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${id}`),
    duration: e.duration_string || formatSeconds(e.duration),
    thumbnail: e.thumbnail || e.thumbnails?.[e.thumbnails.length - 1]?.url,
    requestedBy,
    source: /soundcloud\.com/i.test(e.webpage_url || e.url || '') ? 'soundcloud' : 'youtube'
  };
}

const isSoundCloudUrl = (q) => /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(String(q).trim()) || /^https?:\/\/snd\.sc\//i.test(String(q).trim());

/** SoundCloud through yt-dlp: a single track, a set/playlist (up to 50), or a search. */
async function ytDlpSoundCloud(query, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--flat-playlist', '--playlist-end', '50', '--dump-single-json', '--no-warnings', query], 30000);
  const entries = j.entries ? j.entries.filter(Boolean) : [j];
  return entries.map((e) => {
    const t = trackFromYtDlp({ ...e, webpage_url: e.webpage_url || e.url }, requestedBy);
    return { ...t, source: 'soundcloud', thumbnail: t.thumbnail || j.thumbnail };
  }).filter((t) => t.url && t.title);
}

async function ytDlpSoundCloudSearch(query, requestedBy) {
  // Not "flat": a flat search only returns an internal api link, the full entry has the real track page.
  const j = await ytDlpJson(['--skip-download', '--dump-single-json', '--no-warnings', '--playlist-end', '1', `scsearch1:${query}`], 30000);
  const e = j.entries && j.entries[0];
  if (!e) return [];
  return [{ ...trackFromYtDlp(e, requestedBy), source: 'soundcloud' }];
}

async function ytDlpSearch(query, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--flat-playlist', '--dump-single-json', '--no-warnings', `ytsearch1:${query}`], 15000);
  const e = j.entries && j.entries[0];
  return e ? [trackFromYtDlp(e, requestedBy)] : [];
}

async function ytDlpVideo(url, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--no-playlist', '--dump-json', '--no-warnings', url], 20000);
  return [trackFromYtDlp(j, requestedBy)];
}

async function resolveQuery(query, requestedBy) {
  const started = Date.now();
  try {
    return await resolveQueryInner(query, requestedBy);
  } finally {
    logger.info(`Music: resolved "${String(query).slice(0, 60)}" in ${Date.now() - started} ms`);
  }
}

async function resolveQueryInner(query, requestedBy) {
  query = String(query).trim();

  // SoundCloud: link, or an explicit "sc: название" search.
  const scPrefix = /^(sc|soundcloud)\s*:\s*(.+)$/i.exec(query);
  if (scPrefix) {
    const found = await ytDlpSoundCloudSearch(scPrefix[2].trim(), requestedBy);
    if (!found.length) throw new Error('В SoundCloud ничего не найдено.');
    return found;
  }
  if (isSoundCloudUrl(query)) {
    try {
      const found = await ytDlpSoundCloud(query, requestedBy);
      if (found.length) return found;
    } catch (err) {
      logger.warn?.(`yt-dlp soundcloud failed, using play-dl: ${err.message}`);
    }
    const d = await withTimeout(playdl.soundcloud(query), 15000, 'soundcloud');
    const sec = d.durationInSec || 0;
    return [{ title: d.name, url: d.url, duration: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, thumbnail: d.thumbnail, requestedBy, source: 'soundcloud' }];
  }

  const type = await withTimeout(playdl.validate(query), 5000, 'validate').catch(() => false);

  if (type === 'yt_video') {
    const fast = await ytDlpVideo(query, requestedBy).catch((err) => {
      logger.warn?.(`yt-dlp video lookup failed, using play-dl: ${err.message}`);
      return null;
    });
    if (fast) return fast;
    const info = await withTimeout(playdl.video_basic_info(query), 15000, 'play-dl video');
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
    const playlist = await withTimeout(playdl.playlist_info(query, { incomplete: true }), 15000, 'playlist');
    const videos = await withTimeout(playlist.all_videos(), 30000, 'playlist');
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
    const d = await withTimeout(playdl.soundcloud(query), 15000, 'soundcloud');
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
    const sp = await withTimeout(playdl.spotify(query), 15000, 'spotify');
    const items = sp.type === 'track' ? [sp] : await withTimeout(sp.all_tracks(), 30000, 'spotify');
    const tracks = [];
    for (const item of items) {
      const searchQuery = `${item.name} ${item.artists?.map((a) => a.name).join(' ') || ''}`;
      const found = await ytDlpSearch(searchQuery, requestedBy).catch(() => null);
      if (found && found[0]) {
        tracks.push({ ...found[0], title: `${item.name} — ${item.artists?.[0]?.name || ''}`.trim() });
        continue;
      }
      const results = await withTimeout(playdl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 }), 15000, 'search');
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
  const fast = await ytDlpSearch(query, requestedBy).catch((err) => {
    logger.warn?.(`yt-dlp search failed, using play-dl: ${err.message}`);
    return null;
  });
  if (fast && fast.length) return fast;
  const results = await withTimeout(playdl.search(query, { source: { youtube: 'video' }, limit: 1 }), 15000, 'search').catch(() => []);
  if (!results[0]) return ytDlpSoundCloudSearch(query, requestedBy).catch(() => []);
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

module.exports = { spawnYtDlpAudio, ytDlpBaseArgs, ytDlpFailReason, ytDlpAudioArgs, getQueue, getOrCreateQueue, destroyQueue, resolveQuery, GuildQueue };
