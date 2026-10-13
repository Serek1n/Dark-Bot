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
    for (const p of ['', '/leveling', '/economy', '/level-roles', '/shop', '/leaderboard', '/leaderboard?track=voice', '/leaderboard?track=chat']) {
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

  await test('overview shows the real commands and no stale ones; top and recent actions render', async () => {
    await db.ModLog.create({ guildId: '777000000000000001', userId: '100000000000000009', moderatorId: '100000000000000008', action: 'ban', reason: 'x' });
    const h = await (await fetch(base + '')).text();
    assert(h.includes('/profile') && h.includes('/daily') && h.includes('/mod'), 'commands');
    assert(!h.includes('/settings') && !h.includes('/manage'), 'stale commands still mentioned');
    assert(h.includes('Топ по опыту') && h.includes('Бан'), 'top / recent actions');
  });
  await test('moderation: Russian action names and the action filter', async () => {
    await db.ModLog.create({ guildId: '777000000000000001', userId: '100000000000000009', moderatorId: '100000000000000008', action: 'warn', reason: null });
    const all = await (await fetch(base + '/moderation')).text();
    assert(all.includes('Бан') && all.includes('Предупреждение') && !all.includes('>ban<'), 'labels');
    const only = await (await fetch(base + '/moderation?action=ban')).text();
    assert(only.includes('Бан') && !only.includes('badge badge-warn'), 'filter');
    const junk = await fetch(base + '/moderation?action=%27%3Cscript%3E');
    assert(junk.status === 200, 'junk filter must be ignored');
  });
  await test('economy: totals render; grant adds, takes away, never below zero; bad ID rejected', async () => {
    const id = '100000000000000077';
    let r = await post('/economy/grant', { userId: id, currency: 'coins', amount: '500' });
    assert(r.status === 302 && r.headers.get('location').includes('granted'), 'grant');
    await post('/economy/grant', { userId: id, currency: 'crystals', amount: '7' });
    let p = await db.MemberProfile.findOne({ where: { userId: id } });
    assert(Number(p.balance) === 500 && Number(p.crystals) === 7, `${p.balance}/${p.crystals}`);
    await post('/economy/grant', { userId: id, currency: 'coins', amount: '-9999' });
    p = await db.MemberProfile.findOne({ where: { userId: id } });
    assert(Number(p.balance) === 0, 'must floor at zero: ' + p.balance);
    r = await post('/economy/grant', { userId: 'abc', currency: 'coins', amount: '5' });
    assert(r.headers.get('location').includes('baduser'), 'bad id');
    const page = await (await fetch(base + '/economy')).text();
    assert(page.includes('в обороте') && page.includes('Самые богатые'), 'stats');
  });
  await test('every page ships the unsaved-changes bar and a search box on the leaderboard', async () => {
    for (const p of ['/leveling', '/economy', '/welcome']) assert((await (await fetch(base + p)).text()).includes('id="saveBar"'), p);
    assert((await (await fetch(base + '/leaderboard')).text()).includes('id="lbSearch"'), 'search');
  });

  await test('shop: create, edit, validate, delete', async () => {
    const G = '777000000000000001';
    let r = await post('/shop/items', { name: 'VIP', price: '500', currency: 'crystals', type: 'role', roleId: '223456789012345678', stock: '3', minLevel: '2', enabled: 'on' });
    assert(r.status === 302 && !r.headers.get('location').includes('invalid'), 'create ' + r.headers.get('location'));
    const it = await db.ShopItem.findOne({ where: { guildId: G, name: 'VIP' } });
    assert(it && it.price === 500 && it.currency === 'crystals' && it.stock === 3 && it.minLevel === 2 && it.enabled, 'fields');
    r = await post('/shop/items', { name: 'Bad role', price: '5', type: 'role', roleId: 'zz' });
    assert(r.headers.get('location').includes('invalid'), 'role item without a role is rejected');
    r = await post('/shop/items', { name: '', price: '5' });
    assert(r.headers.get('location').includes('invalid'), 'empty name rejected');
    r = await post('/shop/items/' + it.id, { name: 'VIP+', price: '-5', currency: 'coins', type: 'item', stock: '', deliveryMessage: 'key-1' });
    await it.reload();
    assert(it.name === 'VIP+' && it.price === 1 && it.stock === null && it.type === 'item' && it.enabled === false && it.deliveryMessage === 'key-1', 'edit ' + JSON.stringify(it.toJSON()));
    const page = await (await fetch(base + '/shop')).text();
    assert(page.includes('VIP+') && page.includes('Новый товар'), 'page lists item');
    r = await post('/shop/items/' + it.id + '/delete', {});
    assert(!(await db.ShopItem.findByPk(it.id)), 'deleted');
  });
  await test('shop settings and daily streak settings save', async () => {
    await post('/shop/settings', { shopEnabled: 'on', shopLogChannelId: '123456789012345678' });
    let s = await S(); assert(s.shopEnabled && s.shopLogChannelId === '123456789012345678', 'shop settings');
    await post('/shop/settings', {});
    s = await S(); assert(!s.shopEnabled && !s.shopLogChannelId, 'shop off');
    await post('/economy', { currencyName: 'A', crystalName: 'B', dailyCoins: '50', dailyStreakBonus: '7', dailyStreakMax: '5' });
    s = await S(); assert(s.dailyStreakBonus === 7 && s.dailyStreakMax === 5, 'streak');
  });

  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
