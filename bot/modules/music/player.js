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
const PAUSE_LIMIT_MS = Math.max(IDLE_TIMEOUT_MS, Number(process.env.VOICE_PAUSE_MINUTES || 30) * 60 * 1000); // a pause with people in the channel
// A playlist is cut to this many tracks: each Spotify/Apple track is a separate search, so a 500-track list would keep the bot busy for many minutes.
const MAX_PLAYLIST = 100;
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const LOOP_MODES = ['off', 'track', 'queue', 'playlist'];
const PROGRESS_EVERY_MS = 15_000;

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
  args.push(...jsRuntimeArgs(extra));
  return args;
}

// Since 2025.11.12 yt-dlp needs a JavaScript runtime to solve YouTube's challenges (without it: "n challenge" / "Requested
// format is not available"), and only Deno is on by default. The bot itself runs on Node, so yt-dlp is given this very
// Node, plus permission to fetch the challenge solver (EJS) from GitHub if its build does not carry it. Older yt-dlp does
// not know these options and would refuse to start, so they are added only once the installed version is known to be new
// enough. YTDLP_JS_RUNTIME=off turns this off; a --js-runtimes of your own in YTDLP_EXTRA_ARGS wins.
const EJS_SINCE = '2025.11.12';
const ytDlp = { version: null, checkedAt: 0, probing: null };

/** Asks the installed yt-dlp for its version (in the background; the answer is kept). */
function probeYtDlp() {
  if (ytDlp.probing) return ytDlp.probing;
  ytDlp.probing = new Promise((resolve) => {
    let out = '';
    let proc;
    try { proc = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { proc = null; }
    if (!proc) { ytDlp.probing = null; resolve(null); return; }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15000);
    let done = false;
    const finish = () => { // 'error' (no yt-dlp at all) and 'close' may both come: answer once
      if (done) return;
      done = true;
      clearTimeout(timer);
      const m = out.trim().match(/^(\d{4}\.\d{1,2}\.\d{1,2})/);
      ytDlp.version = m ? m[1] : null;
      ytDlp.checkedAt = Date.now();
      ytDlp.probing = null;
      resolve(ytDlp.version);
    };
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', finish);
    proc.on('close', finish);
  });
  return ytDlp.probing;
}

/** "2025.11.12" ≥ "2025.06.30"? (the versions are dates, so a plain comparison of the padded parts is enough) */
const versionAtLeast = (v, min) => Boolean(v) && v.split('.').map((x) => x.padStart(4, '0')).join('.') >= min.split('.').map((x) => x.padStart(4, '0')).join('.');

function jsRuntimeArgs(extra = '') {
  if (String(process.env.YTDLP_JS_RUNTIME || '').trim().toLowerCase() === 'off') return [];
  if (/--js-runtimes?\b/.test(extra)) return [];
  if (!versionAtLeast(ytDlp.version, EJS_SINCE)) return [];
  const args = ['--js-runtimes', `node:${process.execPath}`];
  if (!/--remote-components\b/.test(extra)) args.push('--remote-components', 'ejs:github');
  return args;
}

// The version is read at start and again every 6 hours (yt-dlp may be updated while the bot runs).
probeYtDlp().then((v) => {
  if (!v) return;
  if (!versionAtLeast(v, EJS_SINCE)) logger.warn(`yt-dlp ${v} устарел: YouTube может не воспроизводиться. Обновите: sudo yt-dlp -U`);
}).catch(() => {});
setInterval(() => { probeYtDlp().catch(() => {}); }, 6 * 3600 * 1000).unref();

/**
 * Why yt-dlp failed, for the people in the chat: short and plain, nothing about the server (null when not recognised).
 * What the bot's admin should do about it goes to the log instead (ytDlpAdminHint).
 */
function ytDlpFailReason(stderr) {
  const t = String(stderr || '');
  if (/confirm your age|age-restricted|inappropriate for some users/i.test(t)) return 'у видео возрастное ограничение';
  if (/Private video|Video unavailable|removed|not available in your country|blocked/i.test(t)) return 'видео недоступно (приватное, удалено или закрыто для региона)';
  if (/not a bot|HTTP Error 403|Forbidden|Requested format is not available|n challenge|JavaScript runtime|nsig|EJS|challenge solver/i.test(t)) return 'YouTube сейчас не отдаёт этот трек';
  if (/ENOENT|not found/i.test(t)) return 'музыка с YouTube сейчас недоступна';
  return null;
}

/** What the bot's admin can do about a failed download, for the log only (null when there is nothing to suggest). */
function ytDlpAdminHint(stderr) {
  const t = String(stderr || '');
  if (/confirm your age|age-restricted|inappropriate for some users/i.test(t)) return 'видео с возрастным ограничением: нужен файл cookies аккаунта YouTube (YTDLP_COOKIES)';
  if (/not a bot/i.test(t)) return 'YouTube просит подтвердить, что это не бот: нужен файл cookies (YTDLP_COOKIES) или другой IP сервера';
  if (/HTTP Error 403|Forbidden/i.test(t)) return 'YouTube отклонил загрузку (403): обновите yt-dlp (sudo yt-dlp -U) или добавьте cookies';
  if (/Requested format is not available|n challenge|JavaScript runtime|nsig|EJS|challenge solver/i.test(t)) {
    if (ytDlp.version && !versionAtLeast(ytDlp.version, EJS_SINCE)) return `yt-dlp ${ytDlp.version} устарел и не справляется с защитой YouTube: sudo yt-dlp -U`;
    return 'yt-dlp не справился с защитой YouTube: обновите его (sudo yt-dlp -U)';
  }
  if (/ENOENT|not found/i.test(t)) return 'yt-dlp не найден на сервере (см. README, раздел про музыку)';
  return null;
}

/** Spawns yt-dlp and returns { proc, stream } with raw audio on stdout. */
function ytDlpAudioArgs(url) {
  // SoundCloud offers a plain mp3 over HTTP next to its HLS streams: take that first, it needs nothing extra.
  const format = /soundcloud\.com|snd\.sc/i.test(String(url)) ? 'http_mp3_1_0/http_mp3/bestaudio/best' : 'bestaudio';
  return [...ytDlpBaseArgs(), '-f', format, '-o', '-', '--quiet', '--no-warnings', '--no-playlist', '--', url]
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
      const hint = ytDlpAdminHint(stderr);
      logger.warn(`yt-dlp exited ${code}${hint ? ' — ' + hint : ''}: ${stderr.trim()}`);
      if (Date.now() - ytDlp.checkedAt > 10 * 60 * 1000) probeYtDlp().catch(() => {}); // perhaps updated meanwhile
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
    /** Repeat: off · track (the current one again) · queue (finished tracks go to the end) · playlist (the DARK playlist starts over). */
    this.loop = 'off';
    /** The DARK playlist being played, for the "repeat playlist" mode: { id, name, tracks, shuffle }. */
    this.playlist = null;
    this._skipped = false; // the current track was skipped (a skip never repeats the track)
    this._progressTimer = null;
    this._bindPlayerEvents();
  }

  /** The next repeat mode for the button: off → track → queue → playlist (only while a playlist plays) → off. */
  cycleLoop() {
    const order = ['off', 'track', 'queue', ...(this.playlist ? ['playlist'] : [])];
    this.loop = order[(order.indexOf(this.loop) + 1) % order.length] || 'off';
    return this.loop;
  }

  setLoop(mode) {
    if (!LOOP_MODES.includes(mode) || (mode === 'playlist' && !this.playlist)) return false;
    this.loop = mode;
    return true;
  }

  /** Shuffles what is waiting (the current track keeps playing). Returns how many were shuffled. */
  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    return this.tracks.length;
  }

  /** Seconds played of the current track. */
  position() {
    const ms = this.player.state?.resource?.playbackDuration;
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  /** What happens to a track that just ended, by the repeat mode. */
  _afterTrack(ended, skipped) {
    if (!ended) return;
    const copy = { ...ended };
    if (this.loop === 'track' && !skipped) this.tracks.unshift(copy);
    else if (this.loop === 'queue') this.tracks.push(copy);
  }

  /** In "repeat playlist" an empty queue takes the playlist again (shuffled again when it was started shuffled). */
  _refillFromPlaylist() {
    if (this.loop !== 'playlist' || !this.playlist?.tracks?.length || this.tracks.length) return false;
    const list = this.playlist.tracks.map((t) => ({ ...t }));
    if (this.playlist.shuffle) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    this.tracks.push(...list);
    return true;
  }

  _startProgress() {
    if (this._progressTimer) return;
    // the bar on the panel moves: one edit every 15 s, well under Discord's limits
    this._progressTimer = setInterval(() => { if (this.playing && !this.paused) this.refreshPanel(); }, PROGRESS_EVERY_MS);
    this._progressTimer.unref?.();
  }

  _stopProgress() {
    if (this._progressTimer) clearInterval(this._progressTimer);
    this._progressTimer = null;
  }

  _bindPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this._killCurrentProcess();
      // Remember what just played, so the "previous" button can bring it back
      // (not when it was re-queued by "previous" itself).
      if (this.playing && !this._skipHistory) {
        this.history.push(this.playing);
        if (this.history.length > 25) this.history.shift();
        this._afterTrack(this.playing, this._skipped);
      }
      this._skipHistory = false;
      this._skipped = false;
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
    return renderPanel({ playing: this.playing, tracks: this.tracks, volume: this.volume, paused: this.paused, canBack: this.history.length > 0,
      loop: this.loop, playlist: this.playlist, position: this.position() });
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
    this._idleSince = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** People (not bots) in the bot's voice channel right now; null when the bot cannot see the channel. */
  listeners() {
    const ch = this.voiceChannel?.guild?.channels?.cache?.get?.(this.voiceChannel.id) || this.voiceChannel;
    const members = ch?.members;
    if (!members || typeof members.values !== 'function') return null;
    return [...members.values()].filter((m) => !m.user?.bot).length;
  }

  /**
   * After IDLE_TIMEOUT_MS without music the bot leaves — but not from people who only paused it: a pause with listeners
   * waits (up to PAUSE_LIMIT_MS in all). Nobody in the channel, or nothing left to play: it leaves and says which.
   */
  _startIdleTimer() {
    const since = this._idleSince || Date.now(); // a re-armed wait keeps counting from its start
    this._clearIdleTimer();
    this._idleSince = since;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const people = this.listeners();
      const waited = Date.now() - this._idleSince;
      if (people && this.paused && this.playing && waited < PAUSE_LIMIT_MS) { this._startIdleTimer(); return; }
      if (people && !this.playing && this.tracks.length) { this.playNext().catch((err) => logger.error('playNext error', err)); return; }
      const minutes = Math.max(1, Math.round(waited / 60000));
      const text = people === 0 ? '👋 В голосовом канале никого нет — выхожу.'
        : this.paused ? `👋 Музыка на паузе уже ${minutes} мин. — выхожу из голосового канала. Включите снова через \`/play\`.`
          : `👋 Музыка не играла ${minutes} мин. — выхожу из голосового канала. Включите снова через \`/play\`.`;
      logger.info?.(`Idle for ${minutes} min (listeners: ${people ?? '?'}, paused: ${this.paused}), leaving voice in guild ${this.guildId}`);
      this.textChannel?.send(text).catch(() => {});
      destroyQueue(this.guildId, 'Бот вышел из голосового канала: музыка не играла.');
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
    this._refillFromPlaylist();
    const next = this.tracks.shift();
    if (!next) {
      this.playing = null;
      this.paused = false;
      this._stopProgress();
      this.retirePanel('Очередь закончилась. Добавьте трек через `/play`.');
      this._startIdleTimer();
      return;
    }
    this._clearIdleTimer();
    try {
      // a track known only by name (Spotify, Apple Music, an imported playlist) is found on YouTube just before it plays
      if (next.lazy) Object.assign(next, await resolveLazy(next));
      let resource;
      if (next.source === 'youtube' || next.source === 'soundcloud') {
        // Both go through yt-dlp: it keeps up with the sites, play-dl's SoundCloud needs a key that expires.
        const { proc, stream } = spawnYtDlpAudio(next.url, (reason) => this._warnSkip(next.title, reason));
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
      this._startProgress();
      await this._showPanel(interaction);
    } catch (err) {
      this._killCurrentProcess();
      logger.error('Failed to start track', next.url, err);
      this._warnSkip(next.title);
      this.playNext(interaction).catch((e) => logger.error('Failed to continue the queue', e));
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
    this._skipped = true; // "repeat track" does not hold a skipped track
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

  /**
   * Tells the channel a track was skipped, at most once per 15 s: a playlist of broken links must not
   * flood the chat (the skipped ones in between are counted in the next message).
   */
  _warnSkip(title, reason) {
    const now = Date.now();
    if (now - (this._lastWarnAt || 0) < 15000) { this._silentSkips = (this._silentSkips || 0) + 1; return; }
    const extra = this._silentSkips ? ` Ещё пропущено треков: ${this._silentSkips}.` : '';
    this._lastWarnAt = now;
    this._silentSkips = 0;
    this.textChannel?.send(`⚠️ Не удалось воспроизвести **${title}**${reason ? ': ' + reason : ''}, пропускаю.${extra}`).catch(() => {});
  }

  stopAndDestroy(note = 'Воспроизведение остановлено.') {
    this._clearIdleTimer();
    this._stopProgress();
    this.loop = 'off';
    this.retirePanel(note);
    this.tracks = [];
    // force: without a voice connection the player would sit in AutoPaused forever and never leave the
    // library's global list of players (a leak per stopped session).
    this.player.stop(true);
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
    const MAX_OUT = 20 * 1024 * 1024; // a playlist answer is a few MB at most; more means something is wrong
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_OUT) { proc.kill('SIGKILL'); clearTimeout(timer); reject(new Error('yt-dlp: ответ слишком большой')); }
    });
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

/** "3:45" / "1:02:03" → seconds (0 when unknown). */
function parseDurationSec(text) {
  const parts = String(text || '').split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Finds a song on YouTube by name: the first five results, and the one whose length is closest to the original
 * (within 15 s) wins — a live version or a one-hour loop is not taken for a 3-minute song.
 */
async function ytDlpSearchBest(query, targetSec, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--flat-playlist', '--dump-single-json', '--no-warnings', '--', `ytsearch5:${query}`], 20000);
  const entries = (j.entries || []).filter((e) => e && e.id);
  if (!entries.length) return null;
  let best = entries[0];
  if (targetSec > 0) {
    const scored = entries.map((e) => ({ e, diff: Math.abs((Number(e.duration) || 0) - targetSec) })).sort((a, b) => a.diff - b.diff);
    if (scored[0].diff <= 15) best = scored[0].e;
  }
  return trackFromYtDlp(best, requestedBy);
}

/** A track known by name only: found on YouTube just before it plays (see GuildQueue.playNext). */
function lazyTrack(item, requestedBy, source = 'spotify') {
  const title = item.artist ? `${item.title} — ${item.artist}` : item.title;
  return {
    title, url: item.spotifyUrl || item.url || null, duration: item.durationSec ? formatSeconds(item.durationSec) : '—', durationSec: item.durationSec || 0,
    thumbnail: item.thumbnail || null, requestedBy, source: 'search', from: source, lazy: true, query: `${item.artist || ''} ${item.title}`.trim()
  };
}

async function resolveLazy(t) {
  const found = await ytDlpSearchBest(t.query || t.title, t.durationSec, t.requestedBy).catch(() => null);
  if (!found) throw new Error(`не нашёл «${t.title}» на YouTube`);
  // keep the original name and cover: they come from the service the link was from
  return { url: found.url, source: 'youtube', lazy: false, duration: t.durationSec ? t.duration : found.duration, thumbnail: t.thumbnail || found.thumbnail, foundTitle: found.title };
}

const isSoundCloudUrl = (q) => /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(String(q).trim()) || /^https?:\/\/snd\.sc\//i.test(String(q).trim());

/** SoundCloud through yt-dlp: a single track, a set/playlist (up to 50), or a search. */
async function ytDlpSoundCloud(query, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--flat-playlist', '--playlist-end', '50', '--dump-single-json', '--no-warnings', '--', query], 30000);
  const entries = j.entries ? j.entries.filter(Boolean) : [j];
  return entries.map((e) => {
    const t = trackFromYtDlp({ ...e, webpage_url: e.webpage_url || e.url }, requestedBy);
    return { ...t, source: 'soundcloud', thumbnail: t.thumbnail || j.thumbnail };
  }).filter((t) => t.url && t.title);
}

async function ytDlpSoundCloudSearch(query, requestedBy) {
  // Not "flat": a flat search only returns an internal api link, the full entry has the real track page.
  const j = await ytDlpJson(['--skip-download', '--dump-single-json', '--no-warnings', '--playlist-end', '1', '--', `scsearch1:${query}`], 30000);
  const e = j.entries && j.entries[0];
  if (!e) return [];
  return [{ ...trackFromYtDlp(e, requestedBy), source: 'soundcloud' }];
}

async function ytDlpSearch(query, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--flat-playlist', '--dump-single-json', '--no-warnings', '--', `ytsearch1:${query}`], 15000);
  const e = j.entries && j.entries[0];
  return e ? [trackFromYtDlp(e, requestedBy)] : [];
}

async function ytDlpVideo(url, requestedBy) {
  const j = await ytDlpJson(['--skip-download', '--no-playlist', '--dump-json', '--no-warnings', '--', url], 20000);
  return [trackFromYtDlp(j, requestedBy)];
}

const { isAppleMusicUrl, resolveAppleMusic } = require('./appleMusic');
const spotify = require('./spotify');

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

  // Apple Music: names from the public page, audio from YouTube.
  if (isAppleMusicUrl(query)) {
    const names = await resolveAppleMusic(query);
    if (!names.length) throw new Error('Apple Music не отдал треки по этой ссылке.');
    // names now, YouTube links just before each one plays: a long album starts at once
    return names.slice(0, MAX_PLAYLIST).map((item) => lazyTrack({ title: item.name, artist: item.artist, durationSec: item.durationSec || 0, thumbnail: item.artwork || null }, requestedBy, 'apple'));
  }

  // Spotify: names, artists, covers and lengths from Spotify, audio from YouTube (Spotify gives bots no audio)
  if (spotify.isSpotifyUrl(query)) {
    const r = await spotify.resolveSpotify(query, { limit: MAX_PLAYLIST });
    if (!r.items.length) throw new spotify.SpotifyError(r.skipped ? 'Все треки по этой ссылке недоступны для воспроизведения.' : 'По этой ссылке Spotify нет треков.', 'empty');
    const tracks = r.items.map((item) => lazyTrack(item, requestedBy, 'spotify'));
    tracks.meta = { name: r.name, type: r.type, skipped: r.skipped || 0, cut: r.cut || 0 };
    return tracks;
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
    return videos.slice(0, MAX_PLAYLIST).map((d) => ({
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

module.exports = { ytDlpJson, spawnYtDlpAudio, ytDlpBaseArgs, ytDlpFailReason, ytDlpAdminHint, ytDlpAudioArgs, probeYtDlp, jsRuntimeArgs, versionAtLeast, _ytDlp: ytDlp, getQueue, getOrCreateQueue, destroyQueue, resolveQuery, GuildQueue,
  ytDlpSearchBest, lazyTrack, resolveLazy, parseDurationSec, formatSeconds, LOOP_MODES, MAX_PLAYLIST };
