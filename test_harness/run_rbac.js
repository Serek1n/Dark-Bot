// Stage 4: access to the panel by roles. A direct request to an address without its scope is refused (403, JSON for the
// API); nobody gives what he has not got, nor «Права доступа», nor to a role not below his own; a member whose role was
// taken loses the panel at once; every address of the panel needs a scope; the strict mode; the list of servers; what a
// member with delegated rights sees.
process.env.DATABASE_PATH = './data/test_rbac.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'r'.repeat(40);
process.env.BOT_OWNER_IDS = '';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

const G = '777000000000000001';
const OWNER = '100000000000000001', MOD = '100000000000000002', ECON = '100000000000000003', MANAGER = '100000000000000004', NOBODY = '100000000000000005', ADMIN = '100000000000000006';
const R_MOD = '600000000000000001', R_HEAD = '600000000000000002', R_TOP = '600000000000000003';
const MANAGE_GUILD = String(1 << 5), ADMINISTRATOR = String(1 << 3);

// ---- Discord as the panel sees it: the user's own list of servers and the bot's view of members ----
const people = {
  [OWNER]: { list: { owner: true, permissions: '0' }, roles: [], perms: [] },
  [MOD]: { list: { owner: false, permissions: '0' }, roles: [R_MOD], perms: [] },
  [ECON]: { list: { owner: false, permissions: '0' }, roles: [R_HEAD], perms: [] },
  [MANAGER]: { list: { owner: false, permissions: MANAGE_GUILD }, roles: [], perms: ['ManageGuild'] },
  [NOBODY]: { list: { owner: false, permissions: '0' }, roles: [], perms: [] },
  [ADMIN]: { list: { owner: false, permissions: ADMINISTRATOR }, roles: [], perms: ['Administrator'] }
};
const ROLES = [{ id: G, name: '@everyone', position: 0 }, { id: R_MOD, name: 'Модератор', position: 1, color: 0 }, { id: R_HEAD, name: 'Старший', position: 2 }, { id: R_TOP, name: 'Совет', position: 5 }];
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
let current = OWNER;
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => { q.user = { id: current, guildsOkAt: Date.now(), guildsAt: Date.now() }; n(); }, signedIn: (q, s, n) => n() });
stub('utils/userGuilds.js', { refreshUserGuilds: async () => [{ id: G, name: 'Night Owls', icon: null, ...people[current].list }], isStale: () => false, MAX_STALE: 3600_000 });
stub('discordApi.js', {
  isHidden: () => false, getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map([[G, { id: G, name: 'Night Owls', icon: null }]]),
  getGuild: async (id) => ({ id, name: 'Night Owls', icon: null }), getGuildChannels: async () => [{ id: '800000000000000001', name: 'общий', type: 0 }], getGuildRoles: async () => ROLES,
  getUsers: async () => ({}), botApi: { get: async () => { throw new Error('offline'); }, post: async () => ({ data: {} }), delete: async () => ({}), put: async () => ({}) }
});
const member = (id) => {
  const p = people[id]; if (!p) return null;
  const positions = p.roles.map((r) => ROLES.find((x) => x.id === r)?.position || 0);
  return { id, roles: { cache: new Map(p.roles.map((r) => [r, {}])), highest: { position: Math.max(0, ...positions) } }, permissions: { has: (x) => p.perms.includes(x) } };
};
const guild = { id: G, ownerId: OWNER, members: { fetch: async (id) => { const m = member(id); if (!m) throw new Error('Unknown Member'); return m; } } };
stub('botBridge.js', { getClient: () => ({ guilds: { cache: new Map([[G, guild]]) }, channels: { fetch: async () => null } }), setClient: () => {}, settingsChanged: () => {} });

(async () => {
  const db = require('../db'); await db.init();
  const access = require('../web/utils/access');
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true })); app.use(express.json());
  app.use(require('../web/middleware/panelAudit').panelAudit);
  const dash = require('../web/routes/dashboard');
  app.use('/dashboard', dash); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard`;
  const as = (who) => { current = who; access.forget(G, who); };
  const get = (p, accept) => fetch(base + p, { redirect: 'manual', headers: accept ? { accept } : {} });
  const form = (body) => { const f = new URLSearchParams(); for (const [k, v] of Object.entries(body)) [].concat(v).forEach((x) => f.append(k, x)); return f.toString(); };
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const patch = (p, body) => fetch(base + p, { method: 'PATCH', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });

  await test('every address of the panel that opens a server needs a scope (none is left to «anyone who got in»)', async () => {
    const missing = [];
    const walk = (stack) => {
      for (const layer of stack) {
        if (layer.route) {
          const names = layer.route.stack.map((x) => x.name);
          if (!names.includes('ensureGuildAccess')) continue;
          for (const m of Object.keys(layer.route.methods)) {
            const p = String(layer.route.path).replace(/^\/:guildId/, '').replace(/:[a-zA-Z]+(\([^)]*\))?(\.png|\.csv)?/g, (x) => (x.includes('.png') ? '1.png' : x.includes('.csv') ? '1.csv' : '123'));
            if (!access.scopeFor(m, p)) missing.push(`${m.toUpperCase()} ${layer.route.path}`);
          }
        } else if (layer.handle && layer.handle.stack) walk(layer.handle.stack);
      }
    };
    walk(dash.stack);
    assert(!missing.length, 'no scope: ' + missing.join(', '));
    assert.strictEqual(access.scopeFor('GET', '/something-new'), null, 'an unknown address is refused');
  });

  await test('the owner and administrators open everything; a member without rights gets 403 and does not see the server', async () => {
    as(OWNER); assert.strictEqual((await get(`/${G}/economy`)).status, 200);
    assert.strictEqual((await get(`/${G}/access`)).status, 200);
    as(ADMIN); assert.strictEqual((await get(`/${G}/access`)).status, 200);
    as(NOBODY);
    assert.strictEqual((await get(`/${G}`)).status, 403);
    assert.strictEqual((await post(`/${G}/economy/grant`, { userId: NOBODY, amount: '1000' })).status, 403);
    const list = await (await get('/')).text();
    assert(!list.includes(`/dashboard/${G}"`), 'not in the list of servers');
  });

  await test('a role with «Младший модератор»: reports and moderation open, economy and access do not — even by a direct POST or PATCH', async () => {
    as(OWNER);
    let r = await post(`/${G}/access/save`, { targetType: 'role', targetId: R_MOD, presetId: 'junior-mod', usePreset: '1' });
    assert(r.headers.get('location').includes('saved=1'), r.headers.get('location'));
    as(MOD);
    assert.strictEqual((await get(`/${G}`)).status, 200);
    assert.strictEqual((await get(`/${G}/moderation-reports`)).status, 200);
    assert.strictEqual((await get(`/${G}/moderation-log`)).status, 200);
    for (const [m, p] of [['GET', '/economy'], ['GET', '/access'], ['GET', '/settings'], ['POST', '/economy/grant'], ['POST', '/moderation-punishments/lift'], ['POST', '/modules/economy'], ['POST', '/access/save']]) {
      const res = m === 'GET' ? await get(`/${G}${p}`) : await post(`/${G}${p}`, { userId: MOD, amount: '5', on: '0', targetType: 'user', targetId: MOD, scopes: 'economy.manage' });
      assert.strictEqual(res.status, 403, `${m} ${p} → ${res.status}`);
    }
    const api = await patch(`/${G}/api/settings/economy.currency`, { values: { currencyName: 'x' } });
    assert(api.status === 403 && (await api.json()).missing.includes('economy.manage'), 'the API answers JSON 403 with the missing scope');
    const html = await (await get(`/${G}/moderation-reports`)).text();
    assert(!html.includes(`/dashboard/${G}/economy"`) && html.includes('id="panel-access"') && !html.includes('data-mod-switch="economy"'), 'no economy in the menu, no module switches');
    const list = await (await get('/')).text();
    assert(list.includes(`/dashboard/${G}`), 'the server is in his list');
  });

  await test('escalation: a member with «Права доступа» gives only what he has, never «Права доступа», never to a role not below his', async () => {
    as(OWNER);
    await post(`/${G}/access/save`, { targetType: 'role', targetId: R_HEAD, scopes: ['overview.view', 'access.manage', 'moderation.read', 'polls.manage'] });
    as(ECON);
    const why = async (body) => { const r = await post(`/${G}/access/save`, body); return decodeURIComponent((r.headers.get('location') || '').split('why=')[1] || 'saved'); };
    assert(/которых нет у вас/.test(await why({ targetType: 'role', targetId: R_MOD, scopes: ['overview.view', 'economy.manage'] })), 'a scope he lacks');
    assert(/только владелец и администраторы/.test(await why({ targetType: 'user', targetId: NOBODY, scopes: ['access.manage'] })), 'access.manage itself');
    assert(/не ниже вашей/.test(await why({ targetType: 'role', targetId: R_TOP, scopes: ['overview.view'] })), 'a role above his');
    assert(/Свои права/.test(await why({ targetType: 'user', targetId: ECON, scopes: ['overview.view', 'polls.manage'] })), 'his own entry');
    assert.strictEqual(await why({ targetType: 'user', targetId: NOBODY, scopes: ['overview.view', 'polls.manage'] }), 'saved', 'a subset of his own to a member');
    const del = await db.PanelRoleAccess.findOne({ where: { guildId: G, targetType: 'role', targetId: R_HEAD } });
    const r = await post(`/${G}/access/${del.id}/delete`);
    assert(decodeURIComponent(r.headers.get('location')).includes('только владелец и администраторы'), 'cannot remove an entry with access.manage');
    const log = await db.PanelAudit.findAll({ where: { guildId: G, action: 'access.grant' } });
    assert(log.length >= 3 && log.some((l) => /Права доступа/.test(l.detail)), 'grants are in the log');
  });

  await test('a moderator whose role was taken loses the panel at the next request (the bot forgets his roles on guildMemberUpdate)', async () => {
    as(MOD); assert.strictEqual((await get(`/${G}/moderation-reports`)).status, 200);
    people[MOD].roles = []; // the role is taken in Discord
    await require('../bot/events/nameCheck').execute({ partial: false, displayName: 'm' }, { id: MOD, guild: { id: G }, user: { bot: false }, displayName: 'm' });
    current = MOD;
    assert.strictEqual((await get(`/${G}/moderation-reports`)).status, 403);
    people[MOD].roles = [R_MOD];
    await require('../bot/events/guildMemberRemove').execute({ id: MOD, guild: { id: G, members: { cache: new Map() } }, user: { bot: false }, roles: { cache: new Map() } }).catch(() => {});
    current = MOD; assert.strictEqual((await get(`/${G}/moderation-reports`)).status, 200, 'back with the role');
  });

  await test('strict mode: «Manage Server» alone no longer opens the panel; only the owner or an administrator switches it', async () => {
    as(MANAGER); assert.strictEqual((await get(`/${G}/economy`)).status, 200, 'full by default');
    let r = await post(`/${G}/access/settings`, { panelStrict: 'on' });
    assert(decodeURIComponent(r.headers.get('location')).includes('только владелец'), 'a manager cannot switch it');
    as(OWNER); r = await post(`/${G}/access/settings`, { panelStrict: 'on' });
    assert(r.headers.get('location').includes('saved=1'));
    as(MANAGER); assert.strictEqual((await get(`/${G}/economy`)).status, 403, 'strict: refused');
    as(OWNER); await post(`/${G}/access/settings`, { _fields: 'panelStrict' });
    as(MANAGER); assert.strictEqual((await get(`/${G}/economy`)).status, 200, 'back');
  });

  await test('changes made with delegated rights go into the panel log', async () => {
    as(OWNER); await post(`/${G}/access/save`, { targetType: 'user', targetId: NOBODY, scopes: ['overview.view', 'polls.manage'] });
    as(NOBODY);
    const r = await post(`/${G}/config/polls`, { _fields: 'maxOptions', maxOptions: '5' });
    assert.strictEqual(r.status, 302);
    await new Promise((res) => setTimeout(res, 50));
    const log = await db.PanelAudit.findOne({ where: { guildId: G, action: 'change', userId: NOBODY } });
    assert(log && log.detail.includes('/config/polls'), 'logged');
    const page = await (await get(`/${G}/polls`)).text();
    assert(page.includes('id="panel-access"') && page.includes('polls.manage'), 'the page knows his rights');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
