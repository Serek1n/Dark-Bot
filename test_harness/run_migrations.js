// Migrations: a new database gets everything once; an OLD database (columns missing, nothing recorded) is brought up to date; a repeat does nothing.
process.env.DATABASE_PATH = './data/test_migrations.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const db = require('../db');
  const q = (sql) => db.sequelize.query(sql).then(([r]) => r);
  await db.init();
  const names = async () => (await q('SELECT name FROM schema_migrations ORDER BY name')).map((r) => r.name);
  const files = fs.readdirSync('./db/migrations').filter((f) => /^\d{4}_/.test(f)).map((f) => f.replace(/\.js$/, '')).sort();
  assert.deepStrictEqual(await names(), files, 'every migration is recorded once');
  const cols = async (t) => (await q(`PRAGMA table_info(${t})`)).map((c) => c.name);
  assert((await cols('guild_settings')).includes('voiceSkipMuted'));

  // an old database: columns missing, an index missing, nothing recorded
  await q('ALTER TABLE guild_settings DROP COLUMN voiceSkipMuted');
  await q('DROP INDEX IF EXISTS member_profiles_guild_xp');
  await q('DELETE FROM schema_migrations');
  await db.init();
  assert((await cols('guild_settings')).includes('voiceSkipMuted'), 'missing column added');
  assert((await q("SELECT name FROM sqlite_master WHERE name = 'member_profiles_guild_xp'")).length === 1, 'missing index created');
  assert.deepStrictEqual(await names(), files);

  // a second start changes nothing
  const before = JSON.stringify(await q('SELECT * FROM schema_migrations'));
  await db.init();
  assert.strictEqual(JSON.stringify(await q('SELECT * FROM schema_migrations')), before, 'already applied migrations are not run again');

  // the old track conversion still works on a database that has old-style data
  await db.MemberProfile.create({ guildId: 'g', userId: 'u', xp: 500, level: 3 });
  await q('DELETE FROM schema_migrations');
  await db.init();
  const p = await db.MemberProfile.findOne({ where: { guildId: 'g', userId: 'u' } });
  assert.strictEqual(Number(p.chatXp), 500);
  console.log('migrations OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
