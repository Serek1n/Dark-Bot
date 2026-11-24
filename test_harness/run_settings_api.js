// The settings schema (shared/settingsSchema.js) and saving without a reload (PATCH …/api/settings/:section).
process.env.DATABASE_PATH = './data/test_settings_api.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const G = '777000000000000001'; const TEXT = '123456789012345678'; const VOICE = '123456789012345679'; const ROLE = '223456789012345678';
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n(), signedIn: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getGuildChannels: async () => [{ id: TEXT, name: 'chat', type: 0 }, { id: VOICE, name: 'voice', type: 2 }],
  getGuildRoles: async () => [{ id: ROLE, name: 'Role' }], getGuild: async (id) => ({ id, name: 'T', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: { get: require('./ownerGuild').ownerGet(G, [ROLE]) }
});
const express = require('express');
const schema = require('../shared/settingsSchema');

(async () => {
  const db = require('../db'); await db.init();
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const patch = (section, values) => fetch(`${base}/api/settings/${section}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const S = () => db.GuildSettings.findOne({ where: { guildId: G } });
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await test('schema: numbers out of range, wrong choices and foreign channels are refused with a text per field', async () => {
    const { values, fieldErrors } = schema.validate('leveling.notify', { levelUpEvery: '0', levelUpDestination: 'nowhere', levelUpChannelId: VOICE, levelUpInVoice: 'on' }, { channels: [{ id: TEXT, type: 0 }, { id: VOICE, type: 2 }] });
    assert(fieldErrors.levelUpEvery === 'Значение от 1 до 100' && fieldErrors.levelUpDestination && fieldErrors.levelUpChannelId && values.levelUpInVoice === true, JSON.stringify({ values, fieldErrors }));
    assert(schema.validate('leveling.accrual', { xpCooldownSeconds: '1.5' }).fieldErrors.xpCooldownSeconds === 'Нужно целое число', 'integer');
    assert(schema.validate('nope', {}).fieldErrors._section, 'unknown section');
  });
  await test('schema: the inputs get the same limits the server checks', async () => {
    const a = schema.attrs('leveling.accrual', 'xpCooldownSeconds');
    assert(a.includes('min="0"') && a.includes('max="3600"') && a.includes('required'), a);
  });
  await test('PATCH: a mistake saves nothing and names the field', async () => {
    await db.GuildSettings.findOrCreate({ where: { guildId: G } });
    const before = (await S()).xpCooldownSeconds;
    const r = await patch('leveling.accrual', { xpCooldownSeconds: '99999', chatEnabled: false });
    assert(r.status === 400 && r.body.fieldErrors.xpCooldownSeconds === 'Значение от 0 до 3600', JSON.stringify(r));
    const s = await S(); assert(s.chatEnabled !== false && s.xpCooldownSeconds === before, 'nothing saved');
  });
  await test('PATCH: only the fields that came are changed; «от» and «до» are put in order', async () => {
    const r = await patch('leveling.accrual', { xpPerMessageMin: '40', xpPerMessageMax: '20', voiceEnabled: false });
    assert(r.status === 200 && r.body.ok, JSON.stringify(r));
    const s = await S();
    assert(s.xpPerMessageMin === 20 && s.xpPerMessageMax === 40 && s.voiceEnabled === false && s.chatEnabled === true, JSON.stringify([s.xpPerMessageMin, s.xpPerMessageMax, s.voiceEnabled, s.chatEnabled]));
  });
  await test('PATCH: a channel of another type is refused; a text channel is saved', async () => {
    let r = await patch('leveling.notify', { levelUpChannelId: VOICE });
    assert(r.status === 400 && r.body.fieldErrors.levelUpChannelId, JSON.stringify(r));
    r = await patch('leveling.notify', { levelUpChannelId: TEXT, levelUpEvery: '5' });
    const s = await S(); assert(r.status === 200 && s.levelUpChannelId === TEXT && s.levelUpEvery === 5, JSON.stringify(r));
  });
  await test('PATCH: a channel deleted in Discord but left as it was does not block the rest', async () => {
    await db.GuildSettings.update({ levelUpChannelId: '999999999999999999' }, { where: { guildId: G } });
    const r = await patch('leveling.notify', { levelUpChannelId: '999999999999999999', levelUpEvery: '3' });
    assert(r.status === 200 && (await S()).levelUpEvery === 3, JSON.stringify(r));
    assert((await patch('leveling.notify', { levelUpChannelId: '888888888888888888' })).status === 400, 'a new unknown one is refused');
  });
  await test('PATCH: an unknown section is 404, a broken body is a readable 400', async () => {
    assert((await patch('nope', {})).status === 404, 'unknown');
    const r = await fetch(`${base}/api/settings/leveling.accrual`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert(r.status === 400 && (await r.json()).ok === false, 'bad json');
  });
  await test('reset: a section goes back to its defaults, other sections stay', async () => {
    await patch('leveling.notify', { levelUpEvery: '7' });
    const r = await fetch(`${base}/api/settings/leveling.accrual/reset`, { method: 'POST', headers: { accept: 'application/json' } }).then((x) => x.json());
    const s = await S();
    assert(r.ok && s.xpPerMessageMin === 10 && s.voiceEnabled === true && s.levelUpEvery === 7, JSON.stringify([s.xpPerMessageMin, s.voiceEnabled, s.levelUpEvery]));
  });

  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
