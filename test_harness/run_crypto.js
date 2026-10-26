// The log webhook token is stored encrypted, read back plain, old plain values keep working and get encrypted by the migration.
process.env.DATABASE_PATH = './data/test_crypto.sqlite';
process.env.SESSION_SECRET = 'x'.repeat(40);
delete process.env.DATA_KEY;
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const c = require('../db/crypto');
  const e = c.encrypt('abc.DEF-123');
  assert(e.startsWith('enc:v1:') && !e.includes('abc'), 'encrypted'); assert.strictEqual(c.decrypt(e), 'abc.DEF-123');
  assert.notStrictEqual(c.encrypt('abc.DEF-123'), e, 'a new random IV every time');
  assert.strictEqual(c.encrypt(e), e, 'not encrypted twice'); assert.strictEqual(c.decrypt('plain'), 'plain', 'old plain value');
  assert.strictEqual(c.encrypt(null), null);
  const tampered = e.slice(0, -4) + (e.endsWith('AAAA') ? 'BBBB' : 'AAAA'); assert.strictEqual(c.decrypt(tampered), null, 'damaged value is refused');
  process.env.DATA_KEY = 'another-key-another-key-1234'; assert.strictEqual(c.decrypt(e), null, 'other key cannot read it'); delete process.env.DATA_KEY;

  const db = require('../db'); await db.init();
  const raw = async (g) => (await db.sequelize.query('SELECT logWebhookToken t FROM guild_settings WHERE guildId = ?', { replacements: [g] }))[0][0]?.t;
  await db.GuildSettings.create({ guildId: 'G1', logWebhookToken: 'secret-token-1' });
  assert((await raw('G1')).startsWith('enc:v1:'), 'create: stored encrypted');
  assert.strictEqual((await db.GuildSettings.findByPk('G1')).logWebhookToken, 'secret-token-1', 'read back plain');
  const s = await db.GuildSettings.findByPk('G1'); s.logWebhookToken = 'secret-token-2'; await s.save();
  assert((await raw('G1')).startsWith('enc:v1:') && (await db.GuildSettings.findByPk('G1')).logWebhookToken === 'secret-token-2', 'save');
  await db.GuildSettings.update({ logWebhookToken: 'secret-token-3' }, { where: { guildId: 'G1' } });
  assert((await raw('G1')).startsWith('enc:v1:') && (await db.GuildSettings.findByPk('G1')).logWebhookToken === 'secret-token-3', 'bulk update');
  await db.GuildSettings.update({ logWebhookToken: null }, { where: { guildId: 'G1' } });
  assert.strictEqual((await db.GuildSettings.findByPk('G1')).logWebhookToken, null, 'cleared');

  // an old database: plain value, migration not yet run
  await db.sequelize.query("INSERT INTO guild_settings (guildId, logWebhookToken, createdAt, updatedAt) VALUES ('G2', 'old-plain-token', datetime('now'), datetime('now'))");
  assert.strictEqual((await db.GuildSettings.findByPk('G2')).logWebhookToken, 'old-plain-token', 'plain value still readable');
  await db.sequelize.query("DELETE FROM schema_migrations WHERE name = '0005_encrypt_log_webhook_token'");
  await db.init();
  assert((await raw('G2')).startsWith('enc:v1:'), 'migration encrypted it');
  assert.strictEqual((await db.GuildSettings.findByPk('G2')).logWebhookToken, 'old-plain-token');
  console.log('crypto OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
