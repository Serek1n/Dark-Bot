// Feature switches: the registry, the command gate, events that must stay silent, and the panel page.
process.env.DATABASE_PATH = './data/test_features.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');
(async () => {
  const db = require('../db'); await db.init();
  const { FEATURES, featureForCommand, isEnabled } = require('../bot/utils/features');
  const { loadCommands } = require('../bot/handlers/loadCommands');
  const L = require('../bot/modules/leveling');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = '777000000000000001';
  const setFlags = async (flags) => { const s = await L.getOrCreateSettings(G); await s.update(flags); };

  await test('every switchable command exists, every column exists, /mod cannot be switched off', async () => {
    const names = new Set([...loadCommands().keys()]);
    for (const f of FEATURES) for (const c of f.commands) assert(names.has(c), 'unknown command ' + c);
    assert(!featureForCommand('mod') && !featureForCommand('help'), 'mod/help must stay on');
    const s = await L.getOrCreateSettings(G);
    FEATURES.forEach((f) => assert(f.field in s.dataValues, 'no column ' + f.field));
    assert(FEATURES.length === new Set(FEATURES.map((f) => f.field)).size, 'fields are unique');
  });
  await test('defaults: everything on except automod and the beta features (they wait for the beta switch)', async () => {
    const s = await L.getOrCreateSettings(G);
    FEATURES.forEach((f) => assert(isEnabled(s, f.key) === (f.key !== 'automod' && !f.beta), f.key));
  });

  const ic = require('../bot/events/interactionCreate');
  const run = async (name) => {
    let ran = false; const replies = [];
    const interaction = { client: { commands: new Map([[name, { execute: async () => { ran = true; } }]]) }, commandName: name, guildId: G, isChatInputCommand: () => true, isContextMenuCommand: () => false, replied: false, deferred: false, reply: async (x) => replies.push(JSON.stringify(x)) };
    await ic.execute(interaction); return { ran, text: replies.join() };
  };
  await test('a switched-off command answers with a note and does not run; switching back works', async () => {
    for (const [name, flag, title] of [['play', 'musicEnabled', 'Музыка'], ['daily', 'economyEnabled', 'Экономика'], ['shop', 'shopEnabled', 'Магазин'], ['profile', 'levelingEnabled', 'Уровни'], ['Report message', 'reportEnabled', 'Жалобы']]) {
      await setFlags({ [flag]: false });
      let r = await run(name); assert(!r.ran && r.text.includes('отключена') && r.text.includes(title), name + ' ' + r.text);
      await setFlags({ [flag]: true });
      r = await run(name); assert(r.ran, name + ' back on');
    }
    await setFlags({ musicEnabled: false, economyEnabled: false });
    assert((await run('mod')).ran && (await run('help')).ran, 'mod and help are never blocked');
    await setFlags({ musicEnabled: true, economyEnabled: true });
  });
  await test('custom commands, welcome, reaction roles, temp rooms and alerts stay silent when off', async () => {
    await db.CustomCommand.create({ guildId: G, trigger: 'hi', response: 'hello', createdBy: 'x' });
    const sent = [];
    const msg = { guild: { id: G, channels: { fetch: async () => null } }, author: { id: 'u', bot: false }, member: null, content: '!hi', channel: { send: async (x) => { sent.push(x); return {}; } }, client: { user: { id: 'b' } } };
    const mc = require('../bot/events/messageCreate');
    await setFlags({ customCommandsEnabled: false, levelingEnabled: false }); await mc.execute(msg); assert(!sent.length, 'custom command ran while off');
    await setFlags({ customCommandsEnabled: true }); await mc.execute(msg); assert(sent.length === 1, 'custom command did not run when on');

    const roles = []; const welcome = [];
    const member = { id: 'm', guild: { id: G, name: 'S', roles: { cache: new Map([['R', {}]]) }, channels: { fetch: async () => ({ send: async (x) => { welcome.push(x); return {}; } }) } }, roles: { add: async (r) => { roles.push(r); } } };
    await setFlags({ autoRoleId: 'R', welcomeChannelId: 'C', welcomeEnabled: false });
    await require('../bot/events/guildMemberAdd').execute(member); assert(!roles.length && !welcome.length, 'welcome ran while off');
    await setFlags({ welcomeEnabled: true });
    await require('../bot/events/guildMemberAdd').execute(member); assert(roles.length === 1 && welcome.length === 1, 'welcome did not run when on');

    await db.ReactionRole.create({ guildId: G, channelId: 'c', messageId: 'M1', emoji: '👍', roleId: 'RR' });
    const added = [];
    const reaction = { partial: false, emoji: { id: null, name: '👍' }, message: { id: 'M1', guild: { id: G, members: { fetch: async () => ({ roles: { add: async (r) => added.push(r), remove: async () => {} } }) }, roles: { cache: new Map([['RR', { id: 'RR' }]]) } } } };
    await setFlags({ reactionRolesEnabled: false }); await require('../bot/events/messageReactionAdd').execute(reaction, { id: 'u', bot: false }); assert(!added.length, 'reaction role ran while off');
    await setFlags({ reactionRolesEnabled: true }); await require('../bot/events/messageReactionAdd').execute(reaction, { id: 'u', bot: false }); assert(added.length === 1, 'reaction role did not run when on');
  });
  await test('the panel page lists every switch and saves them', async () => {
    const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
    app.use('/dashboard', require('../web/routes/dashboard')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
    const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
    const html = await (await fetch(base + '/features')).text();
    FEATURES.forEach((f) => assert(html.includes(`name="${f.field}"`) && html.includes(f.title), 'missing ' + f.key));
    const post = (b) => fetch(base + '/features', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    let r = await post({ musicEnabled: 'on', levelingEnabled: 'on' });
    assert(r.status === 302, 'redirect');
    const s = await db.GuildSettings.findOne({ where: { guildId: G } });
    assert(s.musicEnabled && s.levelingEnabled && !s.shopEnabled && !s.economyEnabled && !s.automodEnabled && !s.alertsEnabled, 'only the ticked ones are on');
    server.close();
  });
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
