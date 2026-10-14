// Manual level changes: the calculation, the roles that follow, and the panel route.
process.env.DATABASE_PATH = './data/test_adjust.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const calls = []; let memberRoles = []; let failPut = false; let memberExists = true;
const botApi = {
  get: async (u) => { calls.push(['GET', u]); if (u.includes('/members/')) { if (!memberExists) throw new Error('404'); return { data: { user: { id: '111111111111111111', bot: false }, roles: memberRoles } }; } return { data: {} }; },
  put: async (u) => { calls.push(['PUT', u]); if (failPut) throw new Error('403'); return {}; },
  delete: async (u) => { calls.push(['DELETE', u]); return {}; }
};
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'Нова', avatar: '' }])), botApi });
const express = require('express');
(async () => {
  const db = require('../db'); await db.init();
  const L = require('../bot/modules/leveling');
  const { computeAdjustRoleChanges } = require('../bot/modules/levelRoles');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = '777000000000000001'; const U = '111111111111111111';

  await test('calculation: add, remove, set land at the start of the level; xp stays chat + voice', async () => {
    const mid = { xp: L.totalXpForLevel(5) + 300, chatXp: 1000, voiceXp: L.totalXpForLevel(5) + 300 - 1000 };
    let r = L.computeLevelAdjust(mid, 'add', 2);
    assert(r.level === 7 && r.previousLevel === 5 && r.xp === L.totalXpForLevel(7), 'add ' + JSON.stringify(r));
    assert(r.chatXp + r.voiceXp === r.xp, 'sum after add');
    r = L.computeLevelAdjust(mid, 'remove', 1);
    assert(r.level === 4 && r.xp === L.totalXpForLevel(4) && r.chatXp + r.voiceXp === r.xp, 'remove ' + JSON.stringify(r));
    assert(L.levelFromXp(r.xp) === 4, 'level matches xp');
    r = L.computeLevelAdjust(mid, 'remove', 4); // takes more than chat has: the rest comes from voice
    assert(r.level === 1 && r.chatXp === 0 && r.voiceXp === r.xp && r.voiceXp >= 0, 'chat runs out ' + JSON.stringify(r));
    r = L.computeLevelAdjust(mid, 'set', 20); assert(r.level === 20 && r.xp === L.totalXpForLevel(20), 'set');
    assert(L.computeLevelAdjust(mid, 'remove', 99).level === 0, 'floor 0');
    assert(L.computeLevelAdjust(mid, 'add', 99999).level === L.MAX_LEVEL, 'ceiling');
    assert(L.computeLevelAdjust({ xp: 0, chatXp: 0, voiceXp: 0 }, 'set', 0).xp === 0, 'zero');
    assert(L.computeLevelAdjust({ xp: 0, chatXp: 0, voiceXp: 0 }, 'remove', 3).level === 0, 'nothing to remove');
  });
  await test('roles: a lower level takes the higher level roles away, a higher one gives roles', async () => {
    const rows = [{ level: 5, roleId: 'R5', track: 'total' }, { level: 10, roleId: 'R10', track: 'total' }, { level: 3, roleId: 'RV', track: 'voice' }];
    let c = computeAdjustRoleChanges(rows, 4, ['R5', 'R10', 'X'], false, true);
    assert(c.remove.sort().join() === 'R10,R5' && !c.add.length, 'drop to 4: ' + JSON.stringify(c));
    c = computeAdjustRoleChanges(rows, 10, ['R5'], false, false);
    assert(c.add.join() === 'R10' && !c.remove.length, 'up to 10 keeps R5: ' + JSON.stringify(c));
    c = computeAdjustRoleChanges(rows, 10, ['R5'], true, false);
    assert(c.add.join() === 'R10' && c.remove.join() === 'R5', 'replace mode: only the top role');
    c = computeAdjustRoleChanges(rows, 20, ['R5', 'RV'], false, false);
    assert(!c.remove.includes('RV'), 'voice-track roles are never touched');
  });

  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (b) => fetch(base + '/leveling/adjust', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  const prof = () => db.MemberProfile.findOne({ where: { guildId: G, userId: U } });
  await db.LevelRole.bulkCreate([{ guildId: G, level: 5, roleId: 'R5', track: 'total' }, { guildId: G, level: 10, roleId: 'R10', track: 'total' }]);

  await test('route: add levels to a member who has no profile yet, roles are given', async () => {
    calls.length = 0; memberRoles = [];
    const r = await post({ userId: U, mode: 'add', amount: '6' });
    const loc = r.headers.get('location');
    assert(r.status === 302 && loc.includes('adjusted=1') && loc.includes('from=0') && loc.includes('to=6') && loc.includes('roles=ok'), loc);
    const p = await prof(); assert(p.level === 6 && Number(p.xp) === L.totalXpForLevel(6), 'saved ' + p.level);
    assert(calls.some((c) => c[0] === 'PUT' && c[1].endsWith('/roles/R5')) && !calls.some((c) => c[1].endsWith('/roles/R10')), JSON.stringify(calls));
  });
  await test('route: removing levels takes level roles away; "set" works; amounts are clamped', async () => {
    calls.length = 0; memberRoles = ['R5', 'R10'];
    let r = await post({ userId: U, mode: 'remove', amount: '3' });
    assert((await prof()).level === 3, 'level 3'); assert(r.headers.get('location').includes('to=3'), 'to');
    assert(calls.filter((c) => c[0] === 'DELETE').map((c) => c[1].split('/').pop()).sort().join() === 'R10,R5', 'both roles removed ' + JSON.stringify(calls));
    await post({ userId: U, mode: 'set', amount: '12' }); assert((await prof()).level === 12, 'set 12');
    await post({ userId: U, mode: 'add', amount: '999999' }); assert((await prof()).level === L.MAX_LEVEL, 'clamped to max');
    await post({ userId: U, mode: 'set', amount: '-5' }); assert((await prof()).level === 0, 'negative set -> 0');
  });
  await test('route: roles that cannot be given are reported, the level is still saved; absent member is fine', async () => {
    memberRoles = []; failPut = true;
    let r = await post({ userId: U, mode: 'set', amount: '6' });
    assert(r.headers.get('location').includes('roles=fail') && (await prof()).level === 6, 'fail flag ' + r.headers.get('location'));
    failPut = false; memberExists = false;
    r = await post({ userId: U, mode: 'set', amount: '7' });
    assert(r.headers.get('location').includes('roles=none') && (await prof()).level === 7, 'left the server');
    memberExists = true;
  });
  await test('route: bad id is rejected and nothing changes', async () => {
    const before = await db.MemberProfile.count();
    const r = await post({ userId: 'abc', mode: 'add', amount: '1' });
    assert(r.headers.get('location').includes('baduser') && (await db.MemberProfile.count()) === before, 'rejected');
  });
  await test('page shows the form, the result line and a prefilled id', async () => {
    let html = await (await fetch(base + `/leveling?adjusted=1&u=${U}&from=3&to=6&roles=ok&user=${U}`)).text();
    assert(html.includes('Изменить уровень участника') && html.includes('Нова: уровень 3 → 6') && html.includes('Роли обновлены') && html.includes(`value="${U}"`), 'content');
    html = await (await fetch(base + '/leveling')).text();
    assert(!html.includes('уровень 3 → 6'), 'no stale result');
  });
  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
