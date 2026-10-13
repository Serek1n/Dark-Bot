// Micro-benchmarks of the hot paths. Run: node test_harness/bench.js
process.env.DATABASE_PATH = './data/bench.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const time = async (label, n, fn) => {
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) await fn(i);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(label.padEnd(52), `${ms.toFixed(0).padStart(6)} ms total  ${(ms / n).toFixed(2).padStart(7)} ms each`);
};
(async () => {
  const db = require('../db'); await db.init();
  const L = require('../bot/modules/leveling');
  const vt = require('../bot/modules/voiceTime');
  const G = 'bench1';
  await L.getOrCreateSettings(G);
  const N = 300;
  await db.MemberProfile.bulkCreate(Array.from({ length: 5000 }, (_, i) => ({ guildId: G, userId: 'u' + i, xp: i * 7, chatXp: i * 7, voiceSeconds: i * 30, balance: i })));
  await time('message xp (member on cooldown, memory hit)', 2000, () => L.grantMessageXp(G, 'u1'));
  await time('message xp (member not on cooldown, db write)', 300, (i) => { const s = L.getOrCreateSettings; return L.grantMessageXp(G, 'u' + (10 + i)); });
  await time('voice xp grant, one member', 300, (i) => L.grantVoiceXp(G, 'u' + i, 10));
  // voice tick with a big channel
  const members = Array.from({ length: N }, (_, i) => ({ id: 'u' + i, user: { bot: false }, voice: { deaf: false }, displayName: 'm' + i, roles: { cache: new Map() } }));
  const channel = { id: 'vc', isVoiceBased: () => true, members: new Map(members.map((m) => [m.id, m])) };
  const guild = { id: G, afkChannelId: null, channels: { cache: new Map([['vc', channel]]) }, roles: { cache: new Map() } };
  members.forEach((m) => { m.guild = guild; });
  const client = { guilds: { cache: new Map([[G, guild]]) } };
  await time(`voice tick, ${N} people in one channel`, 3, () => vt.xpTick(client));
  members.forEach((m) => vt.sessions.set(`${G}:${m.id}`, Date.now() - 300000));
  await time(`flushAll, ${N} sessions`, 3, () => vt.flushAll());
  await time('leaderboard top 10 of 5000', 200, () => L.getLeaderboard(G, 10, 'total'));
  const { renderRankCard } = require('../bot/modules/rankCard');
  const { buildTopPage } = require('../bot/modules/leaderboardPage');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
