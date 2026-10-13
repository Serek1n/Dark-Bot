// Batched voice writes: same results as one-by-one, nothing lost under concurrency.
process.env.DATABASE_PATH = './data/test_batch.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const db = require('../db'); await db.init();
  const L = require('../bot/modules/leveling');
  const vt = require('../bot/modules/voiceTime');
  const { withLocks } = require('../bot/utils/lock');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = 'b1';
  const prof = (u) => db.MemberProfile.findOne({ where: { guildId: G, userId: u } });
  const s = await L.getOrCreateSettings(G); await s.update({ voiceCoinsPerMinute: 3, crystalsPerLevel: 2 });

  await test('batch grant: new members are created, existing ones updated, same numbers as one-by-one', async () => {
    await db.MemberProfile.create({ guildId: G, userId: 'old', xp: 95, chatXp: 95, balance: 7 });
    const r = await L.grantVoiceXpBatch(G, ['old', 'new1', 'new2', 'old'], 10);
    assert(r.size === 3, 'duplicates collapse: ' + r.size);
    const old = await prof('old'), n1 = await prof('new1');
    assert(Number(old.xp) === 105 && Number(old.voiceXp) === 10 && Number(old.chatXp) === 95 && Number(old.balance) === 10, `old ${old.xp}/${old.voiceXp}/${old.balance}`);
    assert(old.level === 1 && Number(old.crystals) === 2 && r.get('old').leveledUp, 'level up pays crystals');
    assert(Number(n1.xp) === 10 && Number(n1.balance) === 3 && n1.level === 0, 'new member');
    assert((await db.MemberProfile.count({ where: { guildId: G } })) === 3, 'no duplicate rows');
    const single = await L.grantVoiceXp(G, 'old', 10);
    assert(Number(single.profile.xp) === 115, 'single path agrees');
  });
  await test('flushAll: adds to existing totals, creates missing profiles, restarts the window', async () => {
    await db.MemberProfile.update({ voiceSeconds: 100 }, { where: { guildId: G, userId: 'old' } });
    vt.sessions.set(`${G}:old`, Date.now() - 60000); vt.sessions.set(`${G}:fresh`, Date.now() - 30000);
    await vt.flushAll();
    assert(Number((await prof('old')).voiceSeconds) === 160, 'old ' + (await prof('old')).voiceSeconds);
    assert(Number((await prof('fresh')).voiceSeconds) === 30, 'fresh');
    await vt.flushAll();
    assert(Number((await prof('old')).voiceSeconds) < 165, 'window restarted, not counted twice');
    vt.sessions.clear();
  });
  await test('message XP and the voice batch at the same moment: nothing is lost', async () => {
    await s.update({ xpPerMessageMin: 5, xpPerMessageMax: 5, xpCooldownSeconds: 0, chatCoinsPerMessage: 0 });
    await db.MemberProfile.update({ xp: 0, chatXp: 0, voiceXp: 0, level: 0, lastXpAt: null }, { where: { guildId: G, userId: 'new1' } });
    await Promise.all([L.grantVoiceXpBatch(G, ['new1', 'x', 'y'], 10), L.grantMessageXp(G, 'new1'), L.grantVoiceXpBatch(G, ['new1'], 10), L.grantMessageXp(G, 'new1')]);
    const p = await prof('new1');
    assert(Number(p.xp) === 30 && Number(p.voiceXp) === 20 && Number(p.chatXp) === 10, `${p.xp}/${p.voiceXp}/${p.chatXp}`);
  });
  await test('withLocks: overlapping key sets never deadlock and run one after another', async () => {
    const order = [];
    await Promise.all([
      withLocks(['a', 'b'], async () => { order.push('1s'); await new Promise((r) => setTimeout(r, 20)); order.push('1e'); }),
      withLocks(['b', 'a'], async () => { order.push('2s'); await new Promise((r) => setTimeout(r, 5)); order.push('2e'); }),
      withLocks(['c'], async () => order.push('3'))
    ]);
    assert(order.join() === '1s,3,1e,2s,2e' || order.join() === '3,1s,1e,2s,2e' || order.indexOf('1e') < order.indexOf('2s'), order.join());
  });
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
