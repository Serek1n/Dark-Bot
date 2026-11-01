// When Discord refuses for lack of rights, the bot names exactly what it needs and where.
process.env.DATABASE_PATH = './data/test_missingperms.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
const { explainMissing, rightsFor } = require('../bot/utils/missingPermissions');
const apiErr = (code, method, route, json) => Object.assign(new Error(code === 50001 ? 'Missing Access' : 'Missing Permissions'), { code, status: 403, method, url: `https://discord.com/api/v10${route}`, requestBody: { json } });
const perms = (...flags) => new PermissionsBitField(flags.reduce((a, f) => a | P[f], 0n));
const CH = '800000000000000001';

(async () => {
  const db = require('../db'); await db.init();
  const channel = { id: CH, permissionsFor: () => perms('ViewChannel', 'SendMessages') }; // no Embed Links, no history
  const guild = { members: { me: { permissions: perms('ViewChannel', 'SendMessages', 'ManageRoles', 'KickMembers') } }, channels: { cache: new Map([[CH, channel]]) } };

  await test('a message the bot could not post: the channel and the missing rights by name', async () => {
    const t = explainMissing(apiErr(50013, 'POST', `/channels/${CH}/messages`, {}), guild);
    assert(t.includes(`<#${CH}>`) && t.includes('Встраивать ссылки') && !t.includes('Отправлять сообщения'), t);
  });
  await test('server-wide actions: mute needs Timeout Members; a role the bot may manage but cannot give is about the role order', async () => {
    const mute = explainMissing(apiErr(50013, 'PATCH', '/guilds/1/members/2', { communication_disabled_until: 'x' }), guild);
    assert(mute.includes('на сервере') && mute.includes('Отправлять в тайм-аут'), mute);
    const role = explainMissing(apiErr(50013, 'PUT', '/guilds/1/members/2/roles/3'), guild);
    assert(/роль бота должна быть выше/.test(role), role);
    assert(explainMissing(apiErr(50013, 'PUT', '/guilds/1/bans/2'), guild).includes('Банить участников'));
  });
  await test('a channel the bot cannot see; other errors are not about rights', async () => {
    assert(explainMissing(apiErr(50001, 'POST', `/channels/${CH}/messages`), guild).includes('не видит канал'));
    assert.strictEqual(explainMissing(Object.assign(new Error('x'), { code: 10008, status: 404 }), guild), null);
    assert.deepStrictEqual(rightsFor('POST', '/channels/1/messages/bulk-delete').perms, ['ViewChannel', 'ManageMessages', 'ReadMessageHistory']);
  });
  await test('a failing command answers with the reason instead of "an error happened"; English servers get it in English', async () => {
    const ic = require('../bot/events/interactionCreate');
    const replies = [];
    const it = { isChatInputCommand: () => true, isContextMenuCommand: () => false, inGuild: () => true, commandName: 'boom', guildId: null, guild, channel, replied: false, deferred: false,
      client: { commands: new Map([['boom', { execute: async () => { throw apiErr(50013, 'POST', `/channels/${CH}/messages`, {}); } }]]) }, reply: async (p) => replies.push(p), followUp: async (p) => replies.push(p) };
    await ic.execute(it);
    const text = replies[0].embeds[0].toJSON().description;
    assert(text.includes('Встраивать ссылки') && text.includes(`<#${CH}>`), text);
    const en = require('../i18n').toEnglish(text, true);
    assert(en.includes('Embed Links') && en.includes('The bot lacks permissions'), en);
  });
  await test('/giveaway start checks the channel before starting and lists what is missing', async () => {
    const cmd = require('../bot/commands/utility/giveaway');
    const { makeInteraction, makeUser } = require('./mock');
    const g = { ...guild, id: '777000000000000001', ownerId: 'X', members: { me: guild.members.me } };
    const i = makeInteraction({ subcommand: 'start', options: { duration: '1h', prize: 'Пицца' }, guild: g, user: makeUser('H'), member: { roles: { highest: { position: 5 } }, permissions: { has: () => true } }, channel });
    i.channelId = CH;
    await cmd.execute(i);
    const t = JSON.stringify(i._replies);
    assert(t.includes('Встраивать ссылки') && t.includes('Читать историю') && !(await db.Giveaway.count()), t);
  });

  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
