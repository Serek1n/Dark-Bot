process.env.DATABASE_PATH = './data/bench_web.sqlite';
const fs = require('fs'); fs.mkdirSync('./data', { recursive: true });
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
  const G = '777000000000000001';
  await db.GuildSettings.findOrCreate({ where: { guildId: G } });
  await db.MemberProfile.bulkCreate(Array.from({ length: 5000 }, (_, i) => ({ guildId: G, userId: String(100000000000000000n + BigInt(i)), xp: i * 7, voiceSeconds: i * 30, balance: i * 3 })));
  await db.ModLog.bulkCreate(Array.from({ length: 3000 }, (_, i) => ({ guildId: G, userId: '1' + i, moderatorId: '2', action: i % 2 ? 'warn' : 'ban', reason: 'x' })));
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  for (const p of ['', '/leveling', '/economy', '/shop', '/moderation', '/leaderboard', '/leaderboard?track=voice', '/leaderboard?q=n1000']) {
    await fetch(base + p); // warm up
    const t = process.hrtime.bigint(); let bytes = 0;
    for (let i = 0; i < 10; i++) { const r = await fetch(base + p); bytes = (await r.text()).length; if (r.status !== 200) throw new Error(p + ' ' + r.status); }
    console.log((p || '/').padEnd(30), (Number(process.hrtime.bigint() - t) / 1e7).toFixed(1).padStart(6), 'ms/req', String(bytes).padStart(8), 'bytes');
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
