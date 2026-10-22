// Voice farming: muted / deafened members are not paid and are not "company"; the switch can turn that off.
process.env.DATABASE_PATH = './data/test_voicefarm.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const db = require('../db'); await db.init();
  const L = require('../bot/modules/leveling');
  const { xpTick } = require('../bot/modules/voiceTime');
  const G = '888000000000000001';
  const set = async (x) => { const s = await L.getOrCreateSettings(G); Object.assign(s, x); await s.save(); };
  const prof = (u) => db.MemberProfile.findOne({ where: { guildId: G, userId: u } });
  await set({ levelingEnabled: true, voiceEnabled: true, voiceXpPerMinute: 10, voiceCoinsPerMinute: 4, voiceMinMembers: 2, channelBoosts: '{}' });
  const member = (id, voice = {}) => ({ id, user: { id, bot: false }, displayName: id, voice: { deaf: false, mute: false, selfDeaf: false, selfMute: false, ...voice }, roles: { cache: new Map() } });
  const tick = (members) => xpTick({ guilds: { cache: new Map([[G, { id: G, afkChannelId: null, channels: { cache: new Map([['c1', { id: 'c1', parentId: null, isVoiceBased: () => true, members: new Map(members.map((m) => [m.id, m])) }]]) } }]]) } });

  await tick([member('real'), member('twin', { selfMute: true })]);
  assert.strictEqual(await prof('real'), null, 'a person alone with a muted twin earns nothing');
  assert.strictEqual(await prof('twin'), null, 'the muted twin earns nothing');

  await tick([member('a'), member('b'), member('c', { selfDeaf: true }), member('d', { mute: true })]);
  assert.strictEqual(Number((await prof('a')).voiceXp), 10);
  assert.strictEqual(Number((await prof('b')).voiceXp), 10);
  assert.strictEqual(await prof('c'), null); assert.strictEqual(await prof('d'), null);

  await set({ voiceSkipMuted: false });
  await tick([member('e'), member('f', { selfMute: true })]);
  assert.strictEqual(Number((await prof('e')).voiceXp), 10, 'with the switch off a muted member counts as before');
  assert.strictEqual(Number((await prof('f')).voiceXp), 10);
  console.log('voicefarm OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
