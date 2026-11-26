// Tests for the music control panel (buttons) without a real Discord or voice connection.
process.env.VOICE_IDLE_MINUTES = '0.005'; // 0.3 s, to test the auto-leave
process.env.YTDLP_PATH = require('path').join(__dirname, 'fake-ytdlp.sh'); // no network, no real yt-dlp
try { require('fs').chmodSync(process.env.YTDLP_PATH, 0o755); } catch {} // git on Windows does not keep the executable bit
process.env.FAKE_YTDLP_LOG = '/tmp/fake-ytdlp-audio.log';
const assert = require('assert');
const { Readable } = require('stream');
// play-dl exports read-only getters, so swap the whole module in the require cache with a copy
// whose stream() returns fake audio (no network, no yt-dlp).
const realPlaydl = require('play-dl');
require.cache[require.resolve('play-dl')].exports = {
  ...realPlaydl,
  stream: async () => ({ stream: new Readable({ read() {} }), type: 'arbitrary' }) // never-ending input: the track keeps "playing"
};
const player = require('../bot/modules/music/player');
const { renderPanel } = require('../bot/modules/music/panelView');
const { isMusicButton, handleMusicButton } = require('../bot/modules/music/panel');

const results = [];
async function run(label, fn) {
  try { await fn(); results.push({ label, ok: true }); } catch (e) { results.push({ label, ok: false, error: e.message, stack: e.stack }); }
}

// A tiny stand-in for a Discord message that records edits.
function fakeMessage(id) {
  return { id, edits: [], edit: async function (p) { this.edits.push(p); return this; } };
}
function fakeTextChannel() {
  const sent = [];
  return { sent, send: async (p) => { const m = fakeMessage(`m${sent.length + 1}`); m.payload = p; sent.push(m); return m; } };
}
function track(n, source = 'other') { // 'other' plays through the stubbed play-dl; youtube/soundcloud go through yt-dlp
  return { title: `Track ${n}`, url: `https://example.com/${n}`, duration: '3:00', requestedBy: 'u1', source };
}
function btn(customId, { guildId = 'g1', channelId = 'vc1', messageId = null } = {}) {
  const calls = [];
  return {
    calls,
    customId,
    guildId,
    member: { voice: { channelId } },
    message: messageId ? { id: messageId } : undefined,
    isButton: () => true,
    update: async (p) => { calls.push(['update', p]); },
    deferUpdate: async () => { calls.push(['deferUpdate']); },
    editReply: async (p) => { calls.push(['editReply', p]); },
    reply: async (p) => { calls.push(['reply', p]); },
    followUp: async (p) => { calls.push(['followUp', p]); }
  };
}
const vc = { id: 'vc1', name: 'Music', guild: { voiceAdapterCreator: () => {} } };

async function main() {
  await run('panel: playing state has 5 control buttons', () => {
    const p = renderPanel({ playing: track(1), tracks: [track(2), track(3)], volume: 0.5, paused: false });
    // Discord limits: max 5 rows, max 5 buttons per row (a 6th button makes the whole message fail).
    assert.ok(p.components.length <= 5);
    p.components.forEach((row) => assert.ok(row.components.length <= 5, 'too many buttons in a row'));
    const ids = p.components.flatMap((r) => r.components).map((c) => c.data.custom_id);
    assert.deepStrictEqual(ids, ['music:prev', 'music:toggle', 'music:skip', 'music:queue', 'music:stop', 'music:voldown', 'music:volup', 'music:shuffle', 'music:loop', 'music:save']);
    assert.ok(p.embeds[0].data.fields.some((f) => f.name.startsWith('Далее')));
  });
  await run('panel: paused state offers "play"', () => {
    const p = renderPanel({ playing: track(1), tracks: [], volume: 0.5, paused: true });
    assert.strictEqual(p.components[0].components[1].data.emoji.name, '▶️');
    assert.ok(p.embeds[0].data.author.name.includes('Пауза'));
  });
  await run('panel: finished queue has no buttons', () => {
    const p = renderPanel({ playing: null, tracks: [], volume: 0.5, paused: false });
    assert.strictEqual(p.components.length, 0);
  });
  await run('panel: very long titles and queues stay within embed limits', () => {
    const long = 'я'.repeat(300);
    const p = renderPanel({ playing: { ...track(1), title: long.slice(0, 256) }, tracks: Array.from({ length: 50 }, () => ({ ...track(2), title: long })), volume: 1.5, paused: false });
    const total = JSON.stringify(p.embeds[0].data).length;
    assert.ok(total < 5000, `embed too large: ${total}`);
    for (const f of p.embeds[0].data.fields) assert.ok(f.value.length <= 1024);
  });

  await run('button: only music buttons are routed', () => {
    assert.ok(isMusicButton(btn('music:skip')));
    assert.ok(!isMusicButton(btn('other:skip')));
  });

  await run('button: no active queue -> dead buttons are cleared', async () => {
    const i = btn('music:toggle', { guildId: 'nope' });
    await handleMusicButton(i);
    assert.deepStrictEqual(i.calls[0][1], { components: [] });
  });

  // ---- a real queue with the panel flow ----
  const text = fakeTextChannel();
  const q = player.getOrCreateQueue('g1', vc, text);

  await run('playNext (no interaction) posts a panel message with buttons', async () => {
    q.enqueue(track(1));
    q.enqueue(track(2));
    await q.playNext();
    assert.strictEqual(text.sent.length, 1);
    assert.strictEqual(text.sent[0].payload.components.length, 2);
    assert.strictEqual(q.panelMessage.id, 'm1');
  });

  await run('playNext (with interaction) reuses the command reply as the panel', async () => {
    const q2 = player.getOrCreateQueue('g2', vc, fakeTextChannel());
    const reply = fakeMessage('reply1');
    const interaction = { editReply: async (p) => { reply.payload = p; return reply; } };
    q2.enqueue(track(9));
    await q2.playNext(interaction);
    assert.strictEqual(q2.panelMessage.id, 'reply1');
    assert.strictEqual(reply.payload.components.length, 2);
    player.destroyQueue('g2');
  });

  await run('button: user outside the bot voice channel is refused', async () => {
    const i = btn('music:toggle', { channelId: 'other', messageId: 'm1' });
    await handleMusicButton(i);
    assert.strictEqual(i.calls[0][0], 'reply');
    assert.ok(i.calls[0][1].flags);
  });

  await run('button: stale panel message is cleaned, not obeyed', async () => {
    const i = btn('music:toggle', { messageId: 'old-message' });
    await handleMusicButton(i);
    assert.deepStrictEqual(i.calls[0][1], { components: [] });
    assert.strictEqual(q.paused, false);
  });

  await run('button: toggle pauses, then resumes, and redraws the panel', async () => {
    const i1 = btn('music:toggle', { messageId: 'm1' });
    await handleMusicButton(i1);
    assert.strictEqual(q.paused, true);
    assert.strictEqual(i1.calls[0][1].components[0].components[1].data.emoji.name, '▶️');
    const i2 = btn('music:toggle', { messageId: 'm1' });
    await handleMusicButton(i2);
    assert.strictEqual(q.paused, false);
    assert.strictEqual(i2.calls[0][1].components[0].components[1].data.emoji.name, '⏸️');
  });


  await run('button: skip starts the next track on a fresh panel and retires the old one', async () => {
    const oldPanel = q.panelMessage;
    const i = btn('music:skip', { messageId: oldPanel.id });
    await handleMusicButton(i);
    assert.strictEqual(i.calls[0][0], 'deferUpdate');
    await new Promise((r) => setTimeout(r, 250)); // Idle event -> playNext
    assert.ok(q.playing && q.playing.title === 'Track 2', 'next track should be playing');
    assert.strictEqual(text.sent.length, 2, 'a new panel message should be posted');
    assert.deepStrictEqual(oldPanel.edits[0], { components: [] }, 'old panel loses its buttons');
  });

  await run('button: previous brings back the track that played before', async () => {
    // after the skip above: Track 2 is playing and Track 1 is in the history
    assert.ok(q.history.length >= 1);
    const panel = q.panelMessage;
    const i = btn('music:prev', { messageId: panel.id });
    await handleMusicButton(i);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(q.playing.title, 'Track 1', 'previous track plays again');
    assert.strictEqual(q.tracks[0] && q.tracks[0].title, 'Track 2', 'the track we left is queued right after it');
  });

  await run('button: previous with no history answers with a hint', async () => {
    const saved = q.history;
    q.history = [];
    const i = btn('music:prev', { messageId: q.panelMessage.id });
    await handleMusicButton(i);
    assert.strictEqual(i.calls[0][0], 'reply');
    q.history = saved;
  });

  await run('button: volume steps by 10% and is clamped to 0..150%', async () => {
    q.volume = 0.5;
    await handleMusicButton(btn('music:volup', { messageId: q.panelMessage.id }));
    assert.strictEqual(q.volume, 0.6);
    q.volume = 1.45;
    await handleMusicButton(btn('music:volup', { messageId: q.panelMessage.id }));
    assert.strictEqual(q.volume, 1.5);
    q.volume = 0.05;
    await handleMusicButton(btn('music:voldown', { messageId: q.panelMessage.id }));
    assert.strictEqual(q.volume, 0);
    q.volume = 0.5;
  });

  await run('button: stop ends the session and retires the panel with a note', async () => {
    const panel = q.panelMessage;
    await handleMusicButton(btn('music:stop', { messageId: panel.id }));
    assert.strictEqual(player.getQueue('g1'), null);
    assert.ok(panel.edits.at(-1).embeds[0].data.description.includes('остановлено'));
    assert.deepStrictEqual(panel.edits.at(-1).components, []);
  });

  await run('idle: queue that ran out leaves voice after the timeout and cleans up', async () => {
    const t = fakeTextChannel();
    const q3 = player.getOrCreateQueue('g3', vc, t);
    q3.enqueue(track(1));
    await q3.playNext();
    q3.tracks = [];
    q3.player.stop(true); // track "ends"
    await new Promise((r) => setTimeout(r, 900));
    assert.strictEqual(player.getQueue('g3'), null);
  });

  await run('idle: a pause with people in the channel does not make the bot leave; nobody there — it leaves and says so', async () => {
    const people = new Map([['p1', { user: { bot: false } }], ['bot', { user: { bot: true } }]]);
    const room = { id: 'vc5', name: 'Music', members: people, guild: { voiceAdapterCreator: () => {}, channels: { cache: new Map() } } };
    const t = fakeTextChannel();
    const q5 = player.getOrCreateQueue('g5', room, t);
    q5.enqueue(track(1));
    await q5.playNext();
    q5.pause();
    await new Promise((r) => setTimeout(r, 900)); // several idle periods
    assert.ok(player.getQueue('g5'), 'still there while people listen to a pause');
    assert.ok(!t.sent.some((m) => /выхожу/.test(String(m.payload))), 'no goodbye');
    people.delete('p1');
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(player.getQueue('g5'), null);
    assert.ok(t.sent.some((m) => /никого нет/.test(String(m.payload))), t.sent.map((m) => String(m.payload)).join(' | '));
  });

  await run('idle: a finished queue with people present leaves with an honest note (no music), not «nobody listens»', async () => {
    const room = { id: 'vc6', name: 'Music', members: new Map([['p1', { user: { bot: false } }]]), guild: { voiceAdapterCreator: () => {}, channels: { cache: new Map() } } };
    const t = fakeTextChannel();
    const q6 = player.getOrCreateQueue('g6', room, t);
    q6.enqueue(track(1));
    await q6.playNext();
    q6.tracks = [];
    q6.player.stop(true);
    await new Promise((r) => setTimeout(r, 900));
    assert.strictEqual(player.getQueue('g6'), null);
    assert.ok(t.sent.some((m) => /Музыка не играла/.test(String(m.payload))), t.sent.map((m) => String(m.payload)).join(' | '));
  });

  await run('race: two starts at once (the player\'s «error» and «idle» for one track) never leave the idle timer on a playing track', async () => {
    const room = { id: 'vc7', name: 'Music', members: new Map([['p1', { user: { bot: false } }]]), guild: { voiceAdapterCreator: () => {}, channels: { cache: new Map() } } };
    const t = fakeTextChannel();
    const q7 = player.getOrCreateQueue('g7', room, t);
    q7.enqueue(track(1));
    await Promise.all([q7.playNext(), q7.playNext()]);
    assert.ok(q7.playing && q7.playing.title === 'Track 1', 'plays');
    assert.strictEqual(q7.idleTimer, null, 'no idle timer while the track plays');
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(player.getQueue('g7'), 'still in voice');
    assert.ok(!t.sent.some((m) => /выхожу/.test(String(m.payload))), 'no goodbye');
    player.destroyQueue('g7');
  });

  await run('idle timer: if it fires while music really plays, the bot stays', async () => {
    const room = { id: 'vc8', name: 'Music', members: new Map([['p1', { user: { bot: false } }]]), guild: { voiceAdapterCreator: () => {}, channels: { cache: new Map() } } };
    const t = fakeTextChannel();
    const q8 = player.getOrCreateQueue('g8', room, t);
    q8.enqueue(track(1));
    await q8.playNext();
    const real = q8.player.state;
    Object.defineProperty(q8.player, 'state', { configurable: true, get: () => ({ ...real, status: 'playing' }), set: () => {} }); // as Discord reports it with a live connection
    q8._startIdleTimer();
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(player.getQueue('g8'), 'did not leave');
    delete q8.player.state;
    player.destroyQueue('g8');
  });

  await run('yt-dlp arguments: SoundCloud asks for the plain mp3 first, YouTube for the best audio', async () => {
    const sc = player.ytDlpAudioArgs('https://soundcloud.com/a/b');
    assert.strictEqual(sc[sc.indexOf('-f') + 1].split('/')[0], 'http_mp3_1_0');
    assert.ok(sc.includes('https://soundcloud.com/a/b') && sc.includes('--no-playlist'));
    assert.strictEqual(player.ytDlpAudioArgs('https://www.youtube.com/watch?v=x')[1], 'bestaudio');
  });

  await run('a SoundCloud track is played through yt-dlp (not through play-dl, which needs an expiring key)', async () => {
    require('fs').rmSync('/tmp/fake-ytdlp-audio.log', { force: true });
    const t = fakeTextChannel();
    const q = player.getOrCreateQueue('g-sc', vc, t);
    q.enqueue({ title: 'SC track', url: 'https://soundcloud.com/a/track', duration: '3:00', requestedBy: 'u1', source: 'soundcloud' });
    await q.playNext();
    assert.ok(q.currentProcess, 'yt-dlp process was started');
    assert.ok(q.playing && q.playing.title === 'SC track', 'track is playing');
    assert.ok(!t.sent.some((m) => JSON.stringify(m.payload).includes('Не удалось')), 'no failure message');
    await new Promise((r) => setTimeout(r, 300));
    const log = require('fs').readFileSync('/tmp/fake-ytdlp-audio.log', 'utf8');
    assert.ok(log.includes('https://soundcloud.com/a/track') && log.includes('http_mp3_1_0'), log);
    q.stopAndDestroy();
  });

  // ---- repeat modes, shuffle, progress, tracks found by name ----
  const endTrack = (q) => new Promise((r) => { q.player.once('stateChange', () => setTimeout(r, 30)); q.player.stop(true); });
  await run('repeat track: a track that ends naturally plays again; a skipped one does not', async () => {
    const q = player.getOrCreateQueue('g-loop1', vc, fakeTextChannel());
    [1, 2].forEach((n) => q.enqueue(track(n)));
    await q.playNext();
    assert.strictEqual(q.setLoop('track'), true);
    await endTrack(q); await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(q.playing.title, 'Track 1', 'repeated');
    q.skip(); await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(q.playing.title, 'Track 2', 'skip moves on even in "repeat track"');
    q.stopAndDestroy();
  });
  await run('repeat queue: finished tracks go to the end, the queue never runs out', async () => {
    const q = player.getOrCreateQueue('g-loop2', vc, fakeTextChannel());
    [1, 2].forEach((n) => q.enqueue(track(n)));
    await q.playNext(); q.setLoop('queue');
    const seen = [q.playing.title];
    for (let i = 0; i < 4; i++) { q.skip(); await new Promise((r) => setTimeout(r, 120)); seen.push(q.playing?.title); }
    assert.deepStrictEqual(seen, ['Track 1', 'Track 2', 'Track 1', 'Track 2', 'Track 1']);
    q.stopAndDestroy();
  });
  await run('repeat playlist: only while a playlist plays; when it ends it starts over; off: the queue ends', async () => {
    const q = player.getOrCreateQueue('g-loop3', vc, fakeTextChannel());
    assert.strictEqual(q.setLoop('playlist'), false, 'no playlist yet');
    assert.deepStrictEqual([q.cycleLoop(), q.cycleLoop(), q.cycleLoop()], ['track', 'queue', 'off'], 'no playlist step without a playlist');
    q.playlist = { id: 1, name: 'Мой', tracks: [track(7), track(8)], shuffle: false };
    q.enqueue(track(7)); q.enqueue(track(8));
    await q.playNext(); assert.strictEqual(q.setLoop('playlist'), true);
    q.skip(); await new Promise((r) => setTimeout(r, 120));
    q.skip(); await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(q.playing?.title, 'Track 7', 'started over: ' + q.playing?.title);
    q.setLoop('off'); q.tracks = [];
    q.skip(); await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(q.playing, null, 'without repeat the queue ends');
    q.stopAndDestroy();
  });
  await run('shuffle keeps every track; the panel shows progress, the repeat mode and the playlist', async () => {
    const q = player.getOrCreateQueue('g-shuf', vc, fakeTextChannel());
    for (let n = 1; n <= 8; n++) q.enqueue(track(n));
    await q.playNext();
    q.shuffle();
    assert.deepStrictEqual(q.tracks.map((t) => t.title).sort(), [2, 3, 4, 5, 6, 7, 8].map((n) => `Track ${n}`).sort());
    q.setLoop('queue'); q.playlist = { name: 'Вечер', tracks: [] };
    const e = q.renderPanel().embeds[0].data;
    assert.ok(/`0:\d\d` ▬*●▬* `3:00`/.test(e.description), e.description);
    assert.ok(e.fields.some((f) => f.name === 'Повтор' && f.value === 'вся очередь') && e.footer.text.includes('Вечер'), JSON.stringify(e));
    q.stopAndDestroy();
  });
  await run('a track known by name is found on YouTube right before it plays; the closest length wins', async () => {
    const q = player.getOrCreateQueue('g-lazy', vc, fakeTextChannel());
    q.enqueue(player.lazyTrack({ title: 'Song', artist: 'Artist', durationSec: 180, thumbnail: 'https://i.scdn.co/x.jpg' }, 'u1'));
    await q.playNext();
    assert.ok(q.playing && q.playing.url === 'https://www.youtube.com/watch?v=right', JSON.stringify(q.playing));
    assert.strictEqual(q.playing.title, 'Song — Artist', 'the name from Spotify stays');
    assert.strictEqual(q.playing.thumbnail, 'https://i.scdn.co/x.jpg', 'the cover from Spotify stays');
    q.stopAndDestroy();
  });
  await run('buttons: shuffle and repeat work from the panel', async () => {
    const t = fakeTextChannel();
    const q = player.getOrCreateQueue('g1', vc, t);
    for (let n = 1; n <= 4; n++) q.enqueue(track(n));
    await q.playNext();
    const b1 = btn('music:loop', { messageId: q.panelMessage?.id });
    await handleMusicButton(b1);
    assert.strictEqual(q.loop, 'track');
    const b2 = btn('music:shuffle', { messageId: q.panelMessage?.id });
    await handleMusicButton(b2);
    assert.strictEqual(q.tracks.length, 3);
    q.stopAndDestroy();
  });

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.label}${r.ok ? '' : ' -> ' + r.error}`));
  failed.forEach((r) => console.log('\n' + r.stack));
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} прошли успешно`);
  process.exit(failed.length ? 1 : 0);
}
main();
