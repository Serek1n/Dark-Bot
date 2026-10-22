// Bot and panel in one process: the panel reads channels / roles / servers from the bot's cache, a broken panel never stops the bot.
process.env.DATABASE_PATH = './data/test_oneprocess.sqlite';
process.env.DISCORD_CLIENT_ID = '1'; process.env.DISCORD_CLIENT_SECRET = 's'; process.env.DISCORD_TOKEN = 'x';
process.env.WEB_BASE_URL = 'http://localhost'; process.env.SESSION_SECRET = 'y'.repeat(48); process.env.WEB_PORT = '0';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const bridge = require('../web/botBridge');
  const api = require('../web/discordApi');

  // no client: REST is used (we only check that nothing is read from a cache)
  assert.strictEqual(bridge.getClient(), null);

  const guild = {
    id: 'G1', name: 'Мой сервер', icon: 'ic', ownerId: 'O', memberCount: 42,
    channels: { cache: new Map([['c1', { id: 'c1', name: 'общий', type: 0, parentId: 'cat', rawPosition: 3 }], ['cat', { id: 'cat', name: 'Игры', type: 4, parentId: null, rawPosition: 0 }]]) },
    roles: { cache: new Map([['G1', { id: 'G1', name: '@everyone', position: 0 }], ['r1', { id: 'r1', name: 'Модер', position: 5, color: 1, managed: false }], ['r2', { id: 'r2', name: 'Гость', position: 1, color: 0, managed: false }]]) }
  };
  const client = { isReady: () => true, guilds: { cache: new Map([['G1', guild]]) }, users: { cache: new Map([['U1', { id: 'U1', username: 'neo', globalName: 'Neo', displayAvatarURL: () => 'https://cdn/x.png' }]]) } };
  bridge.setClient(client);

  assert.deepStrictEqual((await api.getGuildChannels('G1')).map((c) => [c.id, c.type, c.parent_id]), [['c1', 0, 'cat'], ['cat', 4, null]]);
  assert.deepStrictEqual((await api.getGuildRoles('G1')).map((r) => r.id), ['r1', 'r2'], 'no @everyone, highest first');
  const g = await api.getGuild('G1'); assert.strictEqual(g.name, 'Мой сервер'); assert.strictEqual(g.approximate_member_count, 42);
  assert.deepStrictEqual([...(await api.getBotGuildIds())], ['G1']);
  assert.strictEqual((await api.getUsers(['U1'])).U1.name, 'Neo');

  // the panel starts next to the bot, and a bad configuration does not throw
  const web = require('../web');
  const server = await web.start({ client });
  assert(server, 'panel started');
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.strictEqual(res.status, 200);
  await new Promise((r) => server.close(r));

  delete process.env.SESSION_SECRET;
  assert.strictEqual(await web.start({ client }), null, 'no secret: panel off, no exception, no exit');
  console.log('oneprocess OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
