// Channel bonuses: more (or no) XP and coins in chosen channels and categories, chat and voice, and the panel page.
process.env.DATABASE_PATH = './data/test_boosts.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const CH = { text: '111111111111111111', big: '111111111111111112', quiet: '111111111111111113', cat: '111111111111111114', inCat: '111111111111111115', voice: '111111111111111116', voiceInCat: '111111111111111117', thread: '111111111111111118' };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getGuildRoles: async () => [], getUsers: async () => ({}), botApi: {},
  getGuildChannels: async () => [{ id: CH.text, name: 'общий', type: 0 }, { id: CH.big, name: 'бонус', type: 0 }, { id: CH.cat, name: 'Игры', type: 4 }, { id: CH.voice, name: 'Голосовой', type: 2 }, { id: '999999999999999999', name: 'роль-ошибка', type: 99 }]
});
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const L = require('../bot/modules/leveling');
  const { xpTick } = require('../bot/modules/voiceTime');
  const messageCreate = require('../bot/events/messageCreate');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = '777000000000000001';
  const prof = (u) => db.MemberProfile.findOne({ where: { guildId: G, userId: u } });
  const set = async (extra) => { const s = await L.getOrCreateSettings(G); Object.assign(s, extra); await s.save(); };
  await set({ levelingEnabled: true, chatEnabled: true, voiceEnabled: true, xpPerMessageMin: 20, xpPerMessageMax: 20, xpCooldownSeconds: 0, chatCoinsPerMessage: 10, voiceXpPerMinute: 10, voiceCoinsPerMinute: 4, voiceMinMembers: 1, crystalsPerLevel: 0,
    channelBoosts: JSON.stringify({ [CH.big]: { xp: 2, coins: 1.5 }, [CH.quiet]: { xp: 0, coins: 0 }, [CH.cat]: { xp: 3, coins: 3 }, [CH.voice]: { xp: 2, coins: 2.5 }, bad: { xp: 5 } }) });
  let n = 0; const fresh = () => 'u' + ++n;

  await test('parseBoosts: valid entries only, values limited to 0..10 and rounded', async () => {
    const b = L.parseBoosts(JSON.stringify({ [CH.text]: { xp: 99, coins: -3 }, [CH.big]: { xp: 1.456 }, 'not-an-id': { xp: 2 }, [CH.quiet]: 'x' }));
    assert(b[CH.text].xp === 10 && b[CH.text].coins === 0 && b[CH.big].xp === 1.46 && b[CH.big].coins === 1 && Object.keys(b).length === 2, JSON.stringify(b));
    assert(JSON.stringify(L.parseBoosts('{broken')) === '{}' && JSON.stringify(L.parseBoosts('[1]')) === '{}' && JSON.stringify(L.parseBoosts(null)) === '{}', 'garbage becomes empty');
  });
  await test('chat: an ordinary channel pays the normal amount', async () => {
    const u = fresh(); const r = await L.grantMessageXp(G, u, [CH.text]);
    assert(r.gained === 20 && r.coins === 10, JSON.stringify([r.gained, r.coins]));
  });
  await test('chat: a boosted channel pays x2 XP and x1.5 coins', async () => {
    const u = fresh(); const r = await L.grantMessageXp(G, u, [CH.big]);
    assert(r.gained === 40 && r.coins === 15, JSON.stringify([r.gained, r.coins]));
    const p = await prof(u); assert(Number(p.chatXp) === 40 && Number(p.balance) === 15, 'saved');
  });
  await test('chat: a channel that pays nothing gives nothing and does not count the message or the cooldown', async () => {
    const u = fresh(); assert((await L.grantMessageXp(G, u, [CH.quiet])) === null, 'no result');
    assert((await prof(u)) === null, 'nothing was even created');
    assert((await L.grantMessageXp(G, u, [CH.text])).gained === 20, 'the next message elsewhere is paid at once');
  });
  await test('chat: a category bonus covers its channels; the channel\'s own bonus wins; threads fall back to their parent', async () => {
    const a = await L.grantMessageXp(G, fresh(), [CH.inCat, CH.cat]); assert(a.gained === 60 && a.coins === 30, 'category x3: ' + a.gained);
    const b = await L.grantMessageXp(G, fresh(), [CH.big, CH.cat]); assert(b.gained === 40, 'own bonus wins over the category: ' + b.gained);
    const c = await L.grantMessageXp(G, fresh(), [CH.thread, CH.big]); assert(c.gained === 40, 'a thread uses the channel it belongs to');
    const d = await L.grantMessageXp(G, fresh(), [undefined, null]); assert(d.gained === 20, 'unknown place = normal');
  });
  await test('chat: the real message handler passes the channel, its category and its thread parent', async () => {
    const mk = (channel) => ({ guild: { id: G, channels: { fetch: async () => null } }, guildId: G, channelId: channel.id, author: { id: fresh(), bot: false }, member: null, content: 'привет', channel: { send: async () => ({}), ...channel }, client: { user: { id: 'BOT' } }, delete: async () => {} });
    const m1 = mk({ id: CH.inCat, parentId: CH.cat }); await messageCreate.execute(m1);
    assert(Number((await prof(m1.author.id)).chatXp) === 60, 'category bonus through the handler');
    const m2 = mk({ id: CH.thread, parentId: CH.big, parent: { parentId: CH.cat } }); await messageCreate.execute(m2);
    assert(Number((await prof(m2.author.id)).chatXp) === 40, 'thread -> parent channel bonus');
    const m3 = mk({ id: CH.text }); await messageCreate.execute(m3);
    assert(Number((await prof(m3.author.id)).chatXp) === 20, 'plain channel');
  });
  await test('chat: levels and crystals still follow the boosted XP', async () => {
    await set({ crystalsPerLevel: 2 }); const u = fresh();
    const r = await L.grantMessageXp(G, u, [CH.cat]); // 60 xp -> level 0 needs 100
    const r2 = await L.grantMessageXp(G, u, [CH.cat]); // 120 xp -> level 1
    assert(!r.leveledUp && r2.leveledUp && r2.newLevel === 1 && r2.crystals === 2, JSON.stringify([r.leveledUp, r2.newLevel, r2.crystals]));
    await set({ crystalsPerLevel: 0 });
  });

  // ---- voice ----
  const voiceMember = (id, ch) => ({ id, user: { id, bot: false }, displayName: id, voice: { deaf: false }, roles: { cache: new Map() }, ch });
  const guildWith = (channels) => ({
    id: G, afkChannelId: null, channels: { cache: new Map(channels.map((c) => [c.id, { id: c.id, parentId: c.parentId || null, isVoiceBased: () => true, members: new Map(c.members.map((m) => [m, voiceMember(m)])) }])) }
  });
  await test('voice: every channel pays by its own bonus in the same minute', async () => {
    await set({ levelUpChannelId: null });
    const g = guildWith([{ id: CH.voice, members: ['v1'] }, { id: CH.voiceInCat, parentId: CH.cat, members: ['v2'] }, { id: '111111111111111120', members: ['v3'] }]);
    await xpTick({ guilds: { cache: new Map([[G, g]]) } });
    const [a, b, c] = [await prof('v1'), await prof('v2'), await prof('v3')];
    assert(Number(a.voiceXp) === 20 && Number(a.balance) === 10, 'x2 xp, x2.5 coins: ' + [a.voiceXp, a.balance]);
    assert(Number(b.voiceXp) === 30 && Number(b.balance) === 12, 'category x3: ' + [b.voiceXp, b.balance]);
    assert(Number(c.voiceXp) === 10 && Number(c.balance) === 4, 'normal: ' + [c.voiceXp, c.balance]);
  });
  await test('voice: a channel that pays nothing pays nothing; the totals stay chat + voice', async () => {
    await set({ channelBoosts: JSON.stringify({ [CH.voice]: { xp: 0, coins: 0 } }) });
    const g = guildWith([{ id: CH.voice, members: ['v4'] }, { id: '111111111111111121', members: ['v5'] }]);
    await xpTick({ guilds: { cache: new Map([[G, g]]) } });
    assert((await prof('v4')) === null && Number((await prof('v5')).voiceXp) === 10, 'v4 earned nothing, v5 the normal amount');
    const p = await prof('v1'); assert(Number(p.xp) === Number(p.chatXp) + Number(p.voiceXp), 'total = chat + voice');
  });
  await test('voice: half-and-half multipliers round to whole numbers and never go negative', async () => {
    await set({ channelBoosts: JSON.stringify({ [CH.voice]: { xp: 0.25, coins: 0.1 } }), voiceXpPerMinute: 10, voiceCoinsPerMinute: 4 });
    await xpTick({ guilds: { cache: new Map([[G, guildWith([{ id: CH.voice, members: ['v6'] }])]]) } });
    const p = await prof('v6'); assert(Number(p.voiceXp) === 3 && Number(p.balance) === 0, [p.voiceXp, p.balance].join());
  });
  await test('grantVoiceXp / batch keep working without bonuses (default x1)', async () => {
    const r = await L.grantVoiceXp(G, fresh(), 10); assert(r.coins === 4, 'single ' + r.coins);
    const m = await L.grantVoiceXpBatch(G, [fresh(), fresh()], 10); assert([...m.values()].every((x) => x.coins === 4), 'batch');
    const k = await L.grantVoiceXpBatch(G, [fresh()], 10, 2.5); assert([...k.values()][0].coins === 10, 'batch with multiplier');
  });

  // ---- panel ----
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const boosts = async () => L.parseBoosts((await L.getOrCreateSettings(G)).channelBoosts);
  const fresh2 = async () => { const s = await db.GuildSettings.findByPk(G); return s; };
  await test('panel: the page opens, lists boosts with names, marks deleted channels, warns when levels are off', async () => {
    await fresh2().then((s) => s.update({ levelingEnabled: false, channelBoosts: JSON.stringify({ [CH.voice]: { xp: 2, coins: 2.5 }, '123456789012345678': { xp: 0, coins: 1 } }) }));
    const html = await (await fetch(base + '/channel-boosts')).text();
    assert(html.includes('Голосовой') && html.includes('×2,5') && html.includes('канал удалён') && html.includes('×0') && html.includes('выключены'), 'content');
    assert(html.includes('Игры') && html.includes('вся категория') && !html.includes('роль-ошибка'), 'category offered, unknown channel types hidden');
    await fresh2().then((s) => s.update({ levelingEnabled: true }));
  });
  await test('panel: adding a boost (comma decimals), replacing it, and x1/x1 removes it', async () => {
    let r = await post('/channel-boosts', { channelId: CH.big, xp: '2,5', coins: '1.5' }); assert(r.status === 302 && r.headers.get('location').includes('saved=1'), 'saved');
    assert(JSON.stringify((await boosts())[CH.big]) === JSON.stringify({ xp: 2.5, coins: 1.5 }), 'stored');
    await post('/channel-boosts', { channelId: CH.big, xp: '3', coins: '' }); assert(JSON.stringify((await boosts())[CH.big]) === JSON.stringify({ xp: 3, coins: 1 }), 'replaced; empty = x1');
    await post('/channel-boosts', { channelId: CH.big, xp: '1', coins: '1' }); assert(!(await boosts())[CH.big], 'x1/x1 removed');
    await post('/channel-boosts', { channelId: CH.cat, xp: '99', coins: '-4' }); assert(JSON.stringify((await boosts())[CH.cat]) === JSON.stringify({ xp: 10, coins: 0 }), 'limited to 0..10');
  });
  await test('panel: junk is refused (bad id, unknown channel, wrong type, words instead of numbers) and nothing changes', async () => {
    const before = JSON.stringify(await boosts());
    for (const body of [{ channelId: 'abc', xp: '2' }, { channelId: '555555555555555555', xp: '2' }, { channelId: '999999999999999999', xp: '2' }, { channelId: CH.text, xp: 'много' }, { channelId: CH.text, xp: '2', coins: 'x' }]) {
      const r = await post('/channel-boosts', body); assert(r.headers.get('location').includes('invalid=1'), JSON.stringify(body));
    }
    assert(JSON.stringify(await boosts()) === before, 'unchanged');
  });
  await test('panel: removing a boost; removing a missing one is harmless', async () => {
    await post('/channel-boosts', { channelId: CH.text, xp: '2', coins: '2' });
    let r = await post(`/channel-boosts/delete/${CH.text}`, {}); assert(r.status === 302 && !(await boosts())[CH.text], 'removed');
    r = await post('/channel-boosts/delete/42', {}); assert(r.status === 302, 'no error');
  });
  await test('panel: at most 50 boosts', async () => {
    const many = {}; for (let i = 0; i < 50; i++) many[String(222222222222222000n + BigInt(i))] = { xp: 2, coins: 2 };
    await fresh2().then((s) => s.update({ channelBoosts: JSON.stringify(many) }));
    const r = await post('/channel-boosts', { channelId: CH.text, xp: '2', coins: '2' }); assert(r.headers.get('location').includes('invalid=1') && Object.keys(await boosts()).length === 50, 'refused');
    await post('/channel-boosts', { channelId: CH.text, xp: '2', coins: '2' });
  });
  await test('panel: the sidebar link exists on every page', async () => {
    for (const p of ['', '/leveling', '/channel-boosts']) assert((await (await fetch(base + p)).text()).includes('/channel-boosts"'), p || '/');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
