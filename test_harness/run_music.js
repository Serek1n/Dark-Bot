// Tests for the music control panel (buttons) without a real Discord or voice connection.
process.env.VOICE_IDLE_MINUTES = '0.005'; // 0.3 s, to test the auto-leave
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
function track(n, source = 'soundcloud') {
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
    reply: async (p) => { calls.push(['reply', p]); }
  };
}
const vc = { id: 'vc1', name: 'Music', guild: { voiceAdapterCreator: () => {} } };

async function main() {
  await run('panel: playing state has 5 control buttons', () => {
    const p = renderPanel({ playing: track(1), tracks: [track(2), track(3)], volume: 0.5, paused: false });
    assert.strictEqual(p.components.length, 1);
    const ids = p.components[0].components.map((c) => c.data.custom_id);
    assert.deepStrictEqual(ids, ['music:toggle', 'music:skip', 'music:stop', 'music:voldown', 'music:volup']);
    assert.ok(p.embeds[0].data.fields.some((f) => f.name === 'Далее'));
  });
  await run('panel: paused state offers "play"', () => {
    const p = renderPanel({ playing: track(1), tracks: [], volume: 0.5, paused: true });
    assert.strictEqual(p.components[0].components[0].data.label, 'Играть');
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
    assert.strictEqual(text.sent[0].payload.components.length, 1);
    assert.strictEqual(q.panelMessage.id, 'm1');
  });

  await run('playNext (with interaction) reuses the command reply as the panel', async () => {
    const q2 = player.getOrCreateQueue('g2', vc, fakeTextChannel());
    const reply = fakeMessage('reply1');
    const interaction = { editReply: async (p) => { reply.payload = p; return reply; } };
    q2.enqueue(track(9));
    await q2.playNext(interaction);
    assert.strictEqual(q2.panelMessage.id, 'reply1');
    assert.strictEqual(reply.payload.components.length, 1);
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
    assert.strictEqual(i1.calls[0][1].components[0].components[0].data.label, 'Играть');
    const i2 = btn('music:toggle', { messageId: 'm1' });
    await handleMusicButton(i2);
    assert.strictEqual(q.paused, false);
    assert.strictEqual(i2.calls[0][1].components[0].components[0].data.label, 'Пауза');
  });

  await run('button: volume steps by 10% and is clamped to 0..150%', async () => {
    q.volume = 0.5;
    await handleMusicButton(btn('music:volup', { messageId: 'm1' }));
    assert.strictEqual(q.volume, 0.6);
    q.volume = 1.45;
    await handleMusicButton(btn('music:volup', { messageId: 'm1' }));
    assert.strictEqual(q.volume, 1.5);
    q.volume = 0.05;
    await handleMusicButton(btn('music:voldown', { messageId: 'm1' }));
    assert.strictEqual(q.volume, 0);
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

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.label}${r.ok ? '' : ' -> ' + r.error}`));
  failed.forEach((r) => console.log('\n' + r.stack));
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} прошли успешно`);
  process.exit(failed.length ? 1 : 0);
}
main();
