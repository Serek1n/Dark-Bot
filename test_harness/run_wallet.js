// Races on the balance: every change is one additive statement, so nothing is lost or paid twice.
const assert = require('assert');
process.env.DATABASE_PATH = './data/test_wallet.sqlite';
require('fs').mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => require('fs').rmSync(process.env.DATABASE_PATH + x, { force: true }));
const db = require('../db');
const { sequelize, MemberProfile, GuildSettings } = require('../db');
const wallet = require('../bot/modules/wallet');
const leveling = require('../bot/modules/leveling');

(async () => {
  await db.init();
  const G = '100000000000000001', A = '200000000000000001', B = '200000000000000002';
  await GuildSettings.findOrCreate({ where: { guildId: G } });
  const bal = async (u, f = 'balance') => Number((await MemberProfile.findOne({ where: { guildId: G, userId: u } }))[f]);

  // spend never goes below zero, even with many at once
  await wallet.credit(G, A, 'balance', 100);
  const spent = await Promise.all(Array.from({ length: 10 }, () => wallet.spend(G, A, 'balance', 30)));
  assert.strictEqual(spent.filter((x) => x !== null).length, 3, 'only 3 of 10 purchases of 30 fit into 100');
  assert.strictEqual(await bal(A), 10);

  // parallel transfers: money is neither created nor lost
  await wallet.credit(G, A, 'balance', 990); // A = 1000
  const moves = await Promise.all(Array.from({ length: 30 }, () => wallet.transfer(G, A, B, 'balance', 50)));
  assert.strictEqual(moves.filter(Boolean).length, 20);
  assert.strictEqual((await bal(A)) + (await bal(B)), 1000);
  assert.strictEqual(await bal(A), 0);

  // XP / voice at the same time as spending: nothing is overwritten
  const settings = await GuildSettings.findOne({ where: { guildId: G } });
  await wallet.credit(G, A, 'balance', 500);
  await Promise.all([
    ...Array.from({ length: 20 }, () => leveling.grantVoiceXp(G, A, 5, 1)),
    ...Array.from({ length: 10 }, () => wallet.spend(G, A, 'balance', 10)),
    leveling.grantVoiceXpBatch(G, [A, B], 7, 1)
  ]);
  assert.strictEqual(await bal(A, 'voiceXp'), 20 * 5 + 7);
  assert.strictEqual(await bal(A, 'xp'), 20 * 5 + 7);
  const coinsPerMin = Number(settings.voiceCoinsPerMinute) || 0;
  assert.strictEqual(await bal(A), 500 - 100 + coinsPerMin * 21);

  // level and crystals are paid once per level
  const C = '200000000000000003';
  const r = await leveling.grantVoiceXp(G, C, 1000, 1);
  assert.strictEqual(r.newLevel, leveling.levelFromXp(1000));
  assert.strictEqual(await bal(C, 'level'), r.newLevel);
  assert.strictEqual(await bal(C, 'crystals'), r.newLevel * Number(settings.crystalsPerLevel));

  // bad column / amount are refused
  await assert.rejects(() => wallet.credit(G, A, 'level', 1));
  await assert.rejects(() => wallet.credit(G, A, 'balance', -5));
  console.log('wallet OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
