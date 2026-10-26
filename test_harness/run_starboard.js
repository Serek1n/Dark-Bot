// "Доска почёта": copied once at the threshold, counter follows, bots/author/NSFW/other emoji rules, panel settings.
process.env.DATABASE_PATH = './data/test_starboard.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', BOARD = '800000000000000009', CH = '800000000000000001';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getGuildRoles: async () => [], getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'Автор' }])),
  getGuildChannels: async () => [{ id: CH, name: 'общий', type: 0 }, { id: BOARD, name: 'доска', type: 0 }, { id: '800000000000000003', name: 'голос', type: 2 }], getGuild: async (id) => ({ id, name: 'T', icon: null }), botApi: {} });
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
(async () => {
  const db = require('../db'); await db.init();
  const { getOrCreateSettings } = require('../bot/modules/leveling');
  const sb = require('../bot/modules/starboard');
  const s = await getOrCreateSettings(G); s.starboardChannelId = BOARD; s.starboardThreshold = 3; await s.save();

  // a tiny fake Discord
  const posted = []; const edits = [];
  const board = { id: BOARD, nsfw: false, send: async (p) => { posted.push(p); return { id: 'STAR' + posted.length }; }, messages: { fetch: async (id) => ({ id, edit: async (p) => edits.push([id, p]) }) } };
  const guild = { id: G, channels: { cache: new Map([[BOARD, board]]), fetch: async () => null } };
  const author = { id: 'A', username: 'ann', bot: false, displayAvatarURL: () => 'https://cdn/x.png' };
  const mkMessage = (id, extra = {}) => ({ id, guild, channelId: CH, channel: { nsfw: false }, author, content: 'смешная шутка', url: `https://discord.com/channels/${G}/${CH}/${id}`, attachments: new Map(), createdAt: new Date(), ...extra });
  const mkReaction = (message, users, emoji = { id: null, name: '⭐' }) => ({ emoji, message, count: users.length, users: { fetch: async () => new Map(users.map((u) => [u.id, u])) } });
  const u = (id, bot = false) => ({ id, bot });

  await test('below the threshold nothing happens; at 3 people the message is copied once', async () => {
    const m = mkMessage('M1');
    await sb.handleStarReaction(mkReaction(m, [u('1'), u('2')]), u('2'));
    assert.strictEqual(posted.length, 0);
    await sb.handleStarReaction(mkReaction(m, [u('1'), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, 1);
    const p = posted[0];
    assert(p.content.startsWith('⭐ **3**') && p.content.includes(`<#${CH}>`) && p.embeds[0].toJSON().description === 'смешная шутка' && p.allowedMentions.parse.length === 0);
    assert.strictEqual(p.components[0].toJSON().components[0].url, m.url, 'jump button');
    const e = await db.StarboardEntry.findOne({ where: { messageId: 'M1' } }); assert(e.count === 3 && e.starMessageId === 'STAR1' && e.authorId === 'A');
  });
  await test('more reactions update the counter on the copy, never a second copy', async () => {
    const m = mkMessage('M1');
    await sb.handleStarReaction(mkReaction(m, [u('1'), u('2'), u('3'), u('4')]), u('4'));
    assert(posted.length === 1 && edits.length === 1 && edits[0][0] === 'STAR1' && edits[0][1].content.startsWith('⭐ **4**'));
  });
  await test('bots and the author do not count (unless allowed); a bot reacting is ignored entirely', async () => {
    const m = mkMessage('M2');
    await sb.handleStarReaction(mkReaction(m, [u('A'), u('B1', true), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, 1, 'only 2 real votes');
    s.starboardSelfStar = true; await s.save();
    await sb.handleStarReaction(mkReaction(m, [u('A'), u('B1', true), u('2'), u('3')]), u('A'));
    assert.strictEqual(posted.length, 2, 'author allowed: 3');
    s.starboardSelfStar = false; await s.save();
    await sb.handleStarReaction(mkReaction(mkMessage('M9'), [u('1'), u('2'), u('3')]), u('X', true));
    assert.strictEqual(posted.length, 2, 'event from a bot');
  });
  await test('other emoji, the board channel itself and age-restricted channels are skipped', async () => {
    await sb.handleStarReaction(mkReaction(mkMessage('M3'), [u('1'), u('2'), u('3')], { id: null, name: '👍' }), u('3'));
    await sb.handleStarReaction(mkReaction(mkMessage('M4', { channelId: BOARD }), [u('1'), u('2'), u('3')]), u('3'));
    await sb.handleStarReaction(mkReaction(mkMessage('M5', { channel: { nsfw: true } }), [u('1'), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, 2);
  });
  await test('a message from a closed channel does not go to a public board; a closed board may take it', async () => {
    const everyone = { id: G };
    const vis = (seen) => ({ permissionsFor: () => ({ has: () => seen }), guild: { roles: { everyone } }, nsfw: false });
    board.guild = { roles: { everyone } }; board.permissionsFor = () => ({ has: () => true });
    const n = posted.length;
    await sb.handleStarReaction(mkReaction(mkMessage('P1', { channel: vis(false) }), [u('1'), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, n, 'staff channel -> public board: skipped');
    board.permissionsFor = () => ({ has: () => false }); // the board itself is closed too
    await sb.handleStarReaction(mkReaction(mkMessage('P2', { channel: vis(false) }), [u('1'), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, n + 1, 'closed board: allowed');
    delete board.permissionsFor; delete board.guild; posted.pop();
  });
  await test('a custom emoji setting matches by id; the feature switch turns it off', async () => {
    s.starboardEmoji = '<:fire:123456789012345678>'; await s.save();
    await sb.handleStarReaction(mkReaction(mkMessage('M6'), [u('1'), u('2'), u('3')], { id: '123456789012345678', name: 'fire' }), u('3'));
    assert.strictEqual(posted.length, 3);
    s.starboardEmoji = '⭐'; s.starboardEnabled = false; await s.save();
    await sb.handleStarReaction(mkReaction(mkMessage('M7'), [u('1'), u('2'), u('3')]), u('3'));
    assert.strictEqual(posted.length, 3, 'off');
    s.starboardEnabled = true; await s.save();
  });
  await test('a picture becomes the embed image, other files are listed', async () => {
    const att = new Map([['1', { name: 'cat.png', contentType: 'image/png', url: 'https://cdn/cat.png' }], ['2', { name: 'doc.pdf', contentType: 'application/pdf', url: 'https://cdn/doc.pdf' }]]);
    const p = sb.buildPost(mkMessage('M8', { attachments: att, content: '' }), 5, '⭐');
    const e = p.embeds[0].toJSON(); assert(e.image.url === 'https://cdn/cat.png' && e.fields[0].value.includes('doc.pdf') && !e.description);
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((q, r, n) => { q.user = { id: '1', username: 'x' }; r.locals.user = q.user; n(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (body) => fetch(base + '/starboard', { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location'));
  await test('panel: settings saved; voice/foreign channels and junk emoji refused; the best messages are listed', async () => {
    assert((await post({ starboardChannelId: BOARD, starboardEmoji: '🔥', starboardThreshold: '500', starboardSelfStar: 'on' })).includes('saved'));
    const t = await db.GuildSettings.findByPk(G); assert(t.starboardEmoji === '🔥' && t.starboardThreshold === 100 && t.starboardSelfStar === true);
    assert((await post({ starboardChannelId: '800000000000000003' })).includes('badchannel'));
    assert((await post({ starboardChannelId: '899999999999999999' })).includes('badchannel'));
    assert((await post({ starboardChannelId: BOARD, starboardEmoji: '@everyone' })).includes('invalid'));
    assert((await post({ starboardChannelId: BOARD, starboardEmoji: '<:x:1>' })).includes('invalid'));
    const html = await (await fetch(base + '/starboard')).text();
    assert(html.includes('Лучшие сообщения') && html.includes('#общий') && html.includes('Открыть'));
  });
  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
