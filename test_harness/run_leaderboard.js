// The leaderboard is fast: unchanged pages are not drawn again, the next page is prepared in the background, names come from
// the member cache; and it is never stale: any change of XP, level or name draws the page again.
process.env.DATABASE_PATH = './data/test_leaderboard.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = require('../db'); await db.init();
  const G = 'glb';
  for (let i = 0; i < 25; i++) await db.MemberProfile.create({ guildId: G, userId: `55500000000000${1000 + i}`, xp: 10000 - i * 100, level: 30 - i });
  const rc = require('../bot/modules/rankCard');
  let draws = 0; const realRender = rc.renderLeaderboard;
  rc.renderLeaderboard = async (...a) => { draws++; return realRender(...a); };
  // the module took renderLeaderboard by name at load: load it after the counter is in place
  delete require.cache[require.resolve('../bot/modules/leaderboardPage')];
  const lp = require('../bot/modules/leaderboardPage');
  const members = new Map(); for (let i = 0; i < 25; i++) members.set(`55500000000000${1000 + i}`, { displayName: `Member ${i}`, displayAvatarURL: () => null });
  let fetched = 0;
  const client = { users: { cache: new Map(), fetch: async () => { fetched++; return null; } } };
  const guild = { id: G, name: 'Server', members: { cache: members } };

  await test('the next page is drawn in the background; going back draws nothing; names come from the member cache', async () => {
    const first = await lp.buildTopPage(client, guild, 0, 'U');
    assert(first.files.length === 1 && draws === 1, 'first page drawn ' + draws);
    await wait(500);
    assert.strictEqual(draws, 2, 'page 2 prepared');
    await lp.buildTopPage(client, guild, 1, 'U'); await lp.buildTopPage(client, guild, 0, 'U');
    await wait(300);
    assert(draws <= 3, 'no new drawings for pages already made: ' + draws);
    assert.strictEqual(fetched, 0, 'Discord was not asked for names');
  });

  await test('a change of XP draws the page again (never a stale picture); a member not in the cache is asked from Discord', async () => {
    const before = draws;
    await db.MemberProfile.update({ xp: 99999, level: 99 }, { where: { guildId: G, userId: '555000000000001005' } });
    await lp.buildTopPage(client, guild, 0, 'U');
    assert(draws > before, 'drawn again');
    members.delete('555000000000001000'); lp.forgetPages(G);
    await lp.buildTopPage(client, guild, 0, 'U', 'total', { prefetch: false });
    assert(fetched >= 1, 'asked for the missing one');
  });

  rc.renderLeaderboard = realRender;
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
