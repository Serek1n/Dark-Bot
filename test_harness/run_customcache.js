// Custom commands are cached per server and always up to date after a change; a snapshot is written in one statement.
process.env.DATABASE_PATH = './data/test_customcache.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const db = require('../db'); await db.init();
  const { findCustomResponse } = require('../bot/modules/customCommands');
  const G = '111111111111111111';
  assert.strictEqual(await findCustomResponse(G, 'правила'), null);
  await db.CustomCommand.upsert({ guildId: G, trigger: 'правила', response: 'Читай #правила', createdBy: 'u' });
  assert.strictEqual(await findCustomResponse(G, 'правила'), 'Читай #правила', 'a new command is seen at once');
  let queries = 0; const real = db.CustomCommand.findAll.bind(db.CustomCommand);
  db.CustomCommand.findAll = (...a) => { queries++; return real(...a); };
  for (let i = 0; i < 20; i++) await findCustomResponse(G, 'правила');
  assert.strictEqual(queries, 0, 'repeated lookups do not touch the database');
  await db.CustomCommand.upsert({ guildId: G, trigger: 'правила', response: 'Новый текст', createdBy: 'u' });
  assert.strictEqual(await findCustomResponse(G, 'правила'), 'Новый текст', 'an edit is seen at once');
  await db.CustomCommand.destroy({ where: { guildId: G, trigger: 'правила' } });
  assert.strictEqual(await findCustomResponse(G, 'правила'), null, 'a deleted command is gone at once');
  db.CustomCommand.findAll = real;

  const key = { guildId: G, userId: '222222222222222222' };
  await db.MemberSnapshot.upsert({ ...key, roleIds: '["1"]', nickname: 'a', leftAt: new Date() });
  await db.MemberSnapshot.upsert({ ...key, roleIds: '["1","2"]', nickname: 'b', leftAt: new Date() });
  const rows = await db.MemberSnapshot.findAll({ where: key });
  assert.strictEqual(rows.length, 1, 'one row per member'); assert.strictEqual(rows[0].nickname, 'b'); assert.strictEqual(rows[0].roleIds, '["1","2"]');
  // the rank card: the same data gives the same finished picture without drawing again; different data is drawn anew
  const { renderRankCard } = require('../bot/modules/rankCard');
  const card = { rank: 1, totalMembers: 5, username: 'Алиса', avatarURL: null, level: 3, xpIntoLevel: 10, xpNeeded: 100, balance: 5, currencyName: 'монеты', crystals: 1, crystalName: 'кристаллы', chatXp: 1, voiceXp: 1, messageCount: 2, voiceSeconds: 125 };
  const a = await renderRankCard(card); const b = await renderRankCard({ ...card, voiceSeconds: 150 }); // same minute
  assert.strictEqual(a, b, 'served from the cache');
  const c = await renderRankCard({ ...card, level: 4 });
  assert.notStrictEqual(a, c, 'other data, other card');
  assert(a.length > 1000 && a[1] === 0x50, 'a PNG');
  console.log('customcache OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
