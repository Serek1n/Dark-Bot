// Closed holes from the "backdoors" audit: things someone without the right permissions could otherwise do through the bot.
process.env.DATABASE_PATH = './data/test_backdoors.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'b'.repeat(40);
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { makeUser, makeInteraction, makeMember } = require('./mock');
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
const G = '777000000000000001';

(async () => {
  const db = require('../db'); await db.init();

  await test('custom commands: never ping roles or @everyone; one answer per person and channel every 3 s', async () => {
    const { getOrCreateSettings } = require('../bot/modules/leveling');
    const s = await getOrCreateSettings(G); s.customCommandsEnabled = true; s.prefix = '!'; s.levelingEnabled = false; s.automodEnabled = false; await s.save();
    await db.CustomCommand.create({ guildId: G, trigger: 'ping', response: '<@&123> и <@456>', createdBy: 'X' });
    const sent = [];
    const msg = () => ({ guild: { id: G }, author: { id: 'U1', bot: false }, member: null, channelId: 'C1', channel: { send: async (p) => { sent.push(p); return {}; } }, content: '!ping' });
    const handler = require('../bot/events/messageCreate');
    await handler.execute(msg()); await handler.execute(msg());
    assert.strictEqual(sent.length, 1, 'the second call within 3 s is ignored');
    assert.deepStrictEqual(sent[0].allowedMentions, { parse: ['users'] });
  });

  await test('/mod unwarn and clearwarns: not on yourself, not on someone above you', async () => {
    const cmd = require('../bot/commands/moderation/moderation');
    const w = await db.Warning.create({ guildId: 'guild1', userId: 'MOD', moderatorId: 'X', reason: 'r' });
    const i = makeInteraction({ guild: undefined, subcommand: 'unwarn', options: { number: w.id }, user: makeUser('MOD') });
    await cmd.execute(i);
    assert(JSON.stringify(i._replies).includes('другой модератор') && (await db.Warning.findByPk(w.id)), 'own warning stays');
    const boss = await db.Warning.create({ guildId: 'guild1', userId: 'BOSS', moderatorId: 'X', reason: 'r' });
    const j = makeInteraction({ subcommand: 'unwarn', options: { number: boss.id }, user: makeUser('MOD'), member: makeMember('MOD', { rolePosition: 1 }) });
    j.guild.members.fetch = async (id) => makeMember(id, { rolePosition: 10 });
    await cmd.execute(j);
    assert(await db.Warning.findByPk(boss.id), 'a higher member keeps the warning');
    const k = makeInteraction({ subcommand: 'clearwarns', options: { user: makeUser('MOD') }, user: makeUser('MOD') });
    await cmd.execute(k);
    assert(JSON.stringify(k._replies).includes('другой модератор'));
  });

  await test('/remind in a channel where the person cannot write: the reminder goes to DMs, not into the channel', async () => {
    const remind = require('../bot/commands/utility/remind');
    const i = makeInteraction({ subcommand: 'add', options: { time: '10m', text: 'hi' }, user: makeUser('R1') });
    i.channelId = 'NEWS'; i.channel = { permissionsFor: () => ({ has: () => false }) };
    await remind.execute(i);
    const r = await db.Reminder.findOne({ where: { userId: 'R1' } }); assert(r && r.channelId === null, JSON.stringify(r?.toJSON()));
    const j = makeInteraction({ subcommand: 'add', options: { time: '10m', text: 'hi' }, user: makeUser('R2') });
    j.channelId = 'CHAT'; j.channel = { permissionsFor: () => ({ has: () => true }) };
    await remind.execute(j);
    assert.strictEqual((await db.Reminder.findOne({ where: { userId: 'R2' } })).channelId, 'CHAT');
  });

  await test('/poll is refused in a channel where the person cannot write', async () => {
    const poll = require('../bot/commands/utility/poll');
    const i = makeInteraction({ options: { question: 'Q?' }, user: makeUser('P1') });
    i.channel = { permissionsFor: () => ({ has: () => false }) };
    await poll.execute(i);
    assert(JSON.stringify(i._replies).includes('не можете писать'));
  });

  await test('tickets: the author cannot remove the bot or the staff', async () => {
    const tickets = require('../bot/modules/tickets');
    const { getOrCreateSettings } = require('../bot/modules/leveling');
    const s = await getOrCreateSettings('guild1'); s.ticketSupportRoleId = 'SUPPORT'; await s.save();
    await db.Ticket.create({ guildId: 'guild1', channelId: 'TCH', userId: 'AUTH', number: 1, status: 'open' });
    const removed = [];
    const mk = () => { const i = makeInteraction({ user: makeUser('AUTH'), member: makeMember('AUTH', { permissions: { has: () => false }, roles: { cache: new Map() } }) }); i.channel = { id: 'TCH', permissionOverwrites: { delete: async (id) => removed.push(id), edit: async () => {} } }; i.client.user = { id: 'BOT' }; return i; };
    await tickets.changeAccess(mk(), { id: 'BOT' }, false);
    await tickets.changeAccess(mk(), { id: 'STAFF', roles: { cache: new Map([['SUPPORT', {}]]) } }, false);
    await tickets.changeAccess(mk(), { id: 'FRIEND', roles: { cache: new Map() }, permissions: { has: () => false } }, false);
    assert.deepStrictEqual(removed, ['FRIEND']);
  });

  await test('warn escalation needs the moderator\'s own right by default (old servers switched by the migration)', async () => {
    const s = await db.GuildSettings.create({ guildId: '777000000000000099' });
    assert.strictEqual(s.modEscalateNeedsPerm, true);
    await db.sequelize.query("UPDATE guild_settings SET modEscalateNeedsPerm = 0 WHERE guildId = '777000000000000099'");
    await db.sequelize.query("DELETE FROM schema_migrations WHERE name = '0009_escalation_safe_default'");
    await db.init();
    assert.strictEqual((await db.GuildSettings.findByPk('777000000000000099')).modEscalateNeedsPerm, true);
  });

  await test('the panel listens on 127.0.0.1 unless WEB_HOST says otherwise', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.js'), 'utf8');
    assert(/const host = process\.env\.WEB_HOST \|\| '127\.0\.0\.1';/.test(src) && /app\.listen\(port, host,/.test(src));
    assert(/WEB_HOST: 0\.0\.0\.0/.test(fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8')), 'Docker opens it inside the container');
  });

  await test('session: only the needed profile fields, OAuth tokens encrypted', async () => {
    process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1'; process.env.DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 's';
    const { slimUser } = require('../web/passport');
    const { decrypt } = require('../db/crypto');
    const slim = slimUser({ id: '1', username: 'u', avatar: 'a', email: 'x@y', accessToken: 'AT', refreshToken: 'RT', guilds: [{ id: 'g', name: 'G', icon: null, owner: false, permissions: '32', features: ['A', 'B'], approximate_member_count: 5 }] });
    assert(!('email' in slim) && !('features' in slim.guilds[0]) && slim.guilds[0].permissions === '32');
    assert(slim.accessToken.startsWith('enc:v1:') && decrypt(slim.accessToken) === 'AT' && decrypt(slim.refreshToken) === 'RT');
  });

  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
