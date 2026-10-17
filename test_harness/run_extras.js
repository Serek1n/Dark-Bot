// Timed polls and Apple Music links.
process.env.DATABASE_PATH = './data/test_extras.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { makeGuild, makeUser, makeChannel } = require('./mock');

(async () => {
  const db = require('../db'); await db.init();
  const { Poll } = db;
  const poll = require('../bot/commands/utility/poll');
  const polls = require('../bot/modules/polls');
  const apple = require('../bot/modules/music/appleMusic');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  // a fake message that remembers reactions and replies
  const makeMsg = (votes) => {
    const reacted = []; const replies = []; const edits = [];
    const cache = new Map(Object.entries(votes).map(([emoji, n]) => [emoji, { count: n + 1, users: { fetch: async () => new Map([['bot', { bot: true }], ...Array.from({ length: n }, (_, i) => [`u${i}`, { bot: false }])]) } }]));
    return { id: 'M1', channelId: 'C1', reactions: { cache }, react: async (e) => reacted.push(e), reply: async (x) => replies.push(x), edit: async (x) => edits.push(x), reacted, replies, edits };
  };
  const run = async (options, msg) => {
    const replies = [];
    const i = { guild: makeGuild({ id: 'PG1' }), guildId: 'PG1', channelId: 'C1', user: makeUser('U1'), member: { displayName: 'Нея' },
      options: { getString: (n) => options[n] ?? null }, reply: async (x) => replies.push(x), fetchReply: async () => msg };
    await poll.execute(i); return replies;
  };

  await test('poll with a time limit is saved and reacts with the numbers', async () => {
    const msg = makeMsg({});
    await run({ question: 'Что есть?', options: 'Пицца | Суши', duration: '1h' }, msg);
    const p = await Poll.findOne({ where: { guildId: 'PG1' } });
    assert(p && !p.ended && p.messageId === 'M1' && JSON.parse(p.options).length === 2, 'saved');
    assert(msg.reacted.join() === '1️⃣,2️⃣', msg.reacted.join());
    assert(Math.abs(new Date(p.endsAt).getTime() - Date.now() - 3600000) < 5000, 'ends in an hour');
  });
  await test('poll without a time limit is not stored; a bad time is refused', async () => {
    const before = await Poll.count();
    await run({ question: 'Да или нет?' }, makeMsg({}));
    assert(await Poll.count() === before, 'not stored');
    const r = await run({ question: 'x', duration: 'скоро' }, makeMsg({}));
    assert(JSON.stringify(r).includes('Срок голосования'), 'refused');
    assert(await Poll.count() === before, 'still not stored');
  });
  await test('when the time is up the results are posted once, the bot\'s own vote is not counted', async () => {
    const p = await Poll.findOne({ where: { guildId: 'PG1' } });
    const msg = makeMsg({ '1️⃣': 3, '2️⃣': 1 });
    const channel = makeChannel('C1'); channel.messages = { fetch: async () => msg };
    const client = { channels: { fetch: async () => channel } };
    await polls.tick(client); assert(msg.replies.length === 0, 'not yet due');
    await p.update({ endsAt: new Date(Date.now() - 1000) });
    await Promise.all([polls.tick(client), polls.tick(client)]);
    assert(msg.replies.length === 1, 'posted once, got ' + msg.replies.length);
    const text = JSON.stringify(msg.replies[0]);
    assert(text.includes('Всего голосов: **4**') && text.includes('🏆 1️⃣') && text.includes('75%') && !text.includes('🏆 2️⃣'), text);
    assert((await p.reload()).ended === true, 'marked ended');
    await polls.tick(client); assert(msg.replies.length === 1, 'never twice');
  });
  await test('a poll whose message was deleted does not break the timer', async () => {
    const p = await Poll.create({ guildId: 'PG1', channelId: 'C1', messageId: 'GONE', question: 'q', options: '[{"emoji":"👍","label":"Да"}]', endsAt: new Date(Date.now() - 1000) });
    const sent = []; const channel = { messages: { fetch: async () => { throw new Error('Unknown Message'); } }, send: async (x) => sent.push(x) };
    await polls.tick({ channels: { fetch: async () => channel } });
    assert((await p.reload()).ended && sent.length === 1, 'results still sent to the channel');
  });

  await test('Apple Music: links are recognised; an album gives all songs, a ?i= link just one', async () => {
    assert(apple.isAppleMusicUrl('https://music.apple.com/ru/album/x/1') && !apple.isAppleMusicUrl('https://example.com/music.apple.com'), 'detect');
    const ld = { '@type': 'MusicAlbum', name: 'Alb', byArtist: [{ name: 'Art' }], track: [{ name: 'T1 &amp; co', url: 'x?i=1' }, { name: 'T2', url: 'x?i=2', byArtist: [{ name: 'Feat' }] }] };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    assert(JSON.stringify(apple.parseAppleMusicHtml(html)) === '[{"name":"T1 & co","artist":"Art"},{"name":"T2","artist":"Feat"}]', JSON.stringify(apple.parseAppleMusicHtml(html)));
    assert(apple.parseAppleMusicHtml(html, '2').length === 1, 'single');
    assert(apple.parseAppleMusicHtml('<meta property="og:title" content="Song by A on Apple Music">')[0].name === 'Song — A', 'og fallback');
    assert(apple.parseAppleMusicHtml('<html></html>').length === 0, 'nothing found');
  });
  await test('Apple Music: page errors turn into a clear message', async () => {
    let err = null; await apple.resolveAppleMusic('https://music.apple.com/x', async () => ({ ok: false, status: 404 })).catch((e) => { err = e; });
    assert(err && err.message.includes('404'), 'http error');
    err = null; await apple.resolveAppleMusic('https://music.apple.com/x', async () => ({ ok: true, text: async () => '<html></html>' })).catch((e) => { err = e; });
    assert(err && err.message.includes('Не удалось прочитать'), 'empty page');
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
