// HTTP-level tests of the dashboard routes for levels / economy (Discord API and auth are stubbed).
process.env.DATABASE_PATH = './data/test_web.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }],
  getGuildRoles: async () => [{ id: '223456789012345678', name: 'Role' }], getGuild: async (id) => ({ id, name: 'T', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: {}
});
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/777000000000000001`;
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.message }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const S = () => db.GuildSettings.findOne({ where: { guildId: '777000000000000001' } });

  await test('GET all pages return 200', async () => {
    for (const p of ['', '/leveling', '/economy', '/level-roles', '/leaderboard', '/leaderboard?track=voice', '/leaderboard?track=chat']) {
      const r = await fetch(base + p); assert(r.status === 200, `${p || '/'} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  });
  await test('POST leveling saves chat and voice settings separately', async () => {
    const r = await post('/leveling', { levelingEnabled: 'on', chatEnabled: 'on', xpPerMessageMin: '30', xpPerMessageMax: '15', xpCooldownSeconds: '30', chatCoinsPerMessage: '9', crystalsPerLevel: '4',
      voiceXpPerMinute: '12', voiceCoinsPerMinute: '6', voiceMinMembers: '1', levelUpChannelId: '123456789012345678' });
    assert(r.status === 302, 'status ' + r.status);
    const s = await S();
    assert(s.xpPerMessageMin === 15 && s.xpPerMessageMax === 30 && s.chatCoinsPerMessage === 9 && s.crystalsPerLevel === 4, 'chat');
    assert(s.voiceEnabled === false && s.voiceXpPerMinute === 12 && s.voiceCoinsPerMinute === 6 && s.voiceMinMembers === 1 , 'voice (checkbox off => disabled) ' + JSON.stringify([s.voiceEnabled, s.voiceMinMembers]));
    assert(s.chatEnabled === true, 'chat enabled');
  });
  await test('POST leveling clamps junk values', async () => {
    await post('/leveling', { levelingEnabled: 'on', voiceXpPerMinute: '-5', voiceMinMembers: '99', chatCoinsPerMessage: 'abc' });
    const s = await S();
    assert(s.voiceXpPerMinute === 0 && s.voiceMinMembers === 10 && s.chatCoinsPerMessage === 9, JSON.stringify([s.voiceXpPerMinute, s.voiceMinMembers, s.chatCoinsPerMessage]));
  });
  await test('POST economy saves names and daily reward; empty name keeps the old one', async () => {
    await post('/economy', { currencyName: 'золото', crystalName: 'гемы', dailyCoins: '300' });
    let s = await S(); assert(s.currencyName === 'золото' && s.crystalName === 'гемы' && s.dailyCoins === 300, 'saved');
    await post('/economy', { currencyName: '  ', crystalName: '', dailyCoins: '-1' });
    s = await S(); assert(s.currencyName === 'золото' && s.crystalName === 'гемы' && s.dailyCoins === 0, 'fallback ' + s.dailyCoins);
  });
  await test('level roles: one role per level; saving the same level again replaces it; no direction in the table', async () => {
    await post('/level-roles', { level: '5', roleId: '223456789012345678', track: 'voice' }); // track is ignored
    await post('/level-roles', { level: '5', roleId: '223456789012345678' });
    await post('/level-roles', { level: '10', roleId: '223456789012345678' });
    const rows = await db.LevelRole.findAll({ where: { guildId: '777000000000000001' } });
    assert(rows.length === 2 && rows.every((r) => r.track === 'total'), rows.map((r) => r.level + r.track).join());
    const page = await (await fetch(base + '/level-roles')).text();
    assert(!page.includes('Направление'), 'table');
  });
  await test('export: JSON carries both directions + crystals; CSV has the new columns; import restores them', async () => {
    await db.MemberProfile.create({ guildId: '777000000000000001', userId: '100000000000000009', xp: 1000, level: 4, chatXp: 300, voiceXp: 700, balance: 12, crystals: 6, messageCount: 3, voiceSeconds: 90 });
    const json = await (await fetch(base + '/leveling/export')).json();
    const row = json.find((u) => u._id === '100000000000000009');
    assert(row.dark.chatXp === 300 && row.dark.voiceXp === 700 && row.dark.crystals === 6, JSON.stringify(row.dark));
    const csv = await (await fetch(base + '/leveling/export?format=csv')).text();
    assert(csv.split('\n')[0].includes('chat_xp,voice_xp') && csv.includes('100000000000000009,4,1000,300,700,3,90,12,6'), csv);
    await db.MemberProfile.destroy({ where: { userId: '100000000000000009' } });
    const r = await fetch(base + '/leveling/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ users: json }) });
    const j = await r.json(); assert(j.ok && j.imported >= 1, JSON.stringify(j));
    const p = await db.MemberProfile.findOne({ where: { userId: '100000000000000009' } });
    assert(Number(p.chatXp) === 300 && Number(p.voiceXp) === 700 && Number(p.crystals) === 6 && Number(p.xp) === 1000, 'restored ' + [p.chatXp, p.voiceXp, p.crystals]);
  });
  await test('leaderboard tab lists members of the chosen direction only', async () => {
    const h = await (await fetch(base + '/leaderboard?track=voice')).text();
    assert(h.includes('n100000000000000009'), 'member missing');
  });

  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
