// The session store keeps logins in the main database: set/get/touch/destroy and expiry.
process.env.DATABASE_PATH = './data/test_sessions.sqlite';
const assert = require('assert');
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { init } = require('../db');
const { SequelizeStore } = require('../web/sessionStore');
const p = (fn) => new Promise((res, rej) => fn((e, v) => (e ? rej(e) : res(v))));

(async () => {
  await init();
  const store = new SequelizeStore({ cleanupMs: 3600000 });
  const live = { cookie: { expires: new Date(Date.now() + 60000) }, passport: { user: { id: '1' } } };
  await p((cb) => store.set('a', live, cb));
  assert.deepStrictEqual((await p((cb) => store.get('a', cb))).passport.user, { id: '1' });
  await p((cb) => store.set('a', { ...live, extra: 1 }, cb)); // overwrite
  assert.strictEqual((await p((cb) => store.get('a', cb))).extra, 1);
  await p((cb) => store.set('old', { cookie: { expires: new Date(Date.now() - 1000) } }, cb));
  assert.strictEqual(await p((cb) => store.get('old', cb)), null, 'expired session is not returned');
  await store.cleanup();
  await p((cb) => store.touch('a', { cookie: { expires: new Date(Date.now() + 120000) } }, cb));
  await p((cb) => store.destroy('a', cb));
  assert.strictEqual(await p((cb) => store.get('a', cb)), null);
  assert.strictEqual(await p((cb) => store.get('missing', cb)), null);
  console.log('sessions OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
