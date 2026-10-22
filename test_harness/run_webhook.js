// /webhook: create, list, delete and send through webhooks.
process.env.BOT_CHANNEL = 'beta'; // these tests are about the beta build
process.env.DATABASE_PATH = './data/test_webhook.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits } = require('discord.js');

(async () => {
  const db = require('../db'); await db.init();
  const cmd = require('../bot/commands/utility/webhook');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const BOT = 'BOT1'; const sent = []; const deleted = [];
  const hook = (id, owner, name = 'h' + id) => ({ id, name, channelId: 'C1', url: `https://discord.com/api/webhooks/${id}/tok`, owner: { id: owner }, send: async (x) => sent.push([id, x]), delete: async (r) => deleted.push([id, r]) });
  let store = [hook('1', BOT), hook('2', 'SOMEONE'), hook('LOG', BOT)];
  const created = [];
  const channel = { id: 'C1', createWebhook: async (o) => { if (channel.fail) throw new Error(channel.fail); created.push(o); const h = hook('N' + created.length, BOT, o.name); store.push(h); return h; } };
  const guild = { id: 'WG1', client: { user: { id: BOT } }, members: { me: { permissions: { has: () => guild.botCan !== false } } }, fetchWebhooks: async () => new Map(store.map((h) => [h.id, h])) };
  await db.GuildSettings.create({ guildId: 'WG1', logWebhookId: 'LOG' });
  const member = (can) => ({ permissions: { has: (f) => (can ? true : f !== PermissionFlagsBits.ManageWebhooks) } });
  const run = async (sub, o = {}, { can = true } = {}) => {
    const replies = [];
    const i = { guild, member: member(can), user: { id: 'U', username: 'neya' }, client: { user: { displayAvatarURL: () => 'https://cdn/bot.png' } }, replied: false, deferred: false,
      options: { getSubcommand: () => sub, getString: (n) => o[n] ?? null, getChannel: () => o.channel ?? channel, getAttachment: () => o.avatar ?? null },
      reply: async (x) => replies.push(x) };
    await cmd.execute(i); return JSON.stringify(replies);
  };

  await test('definition: needs Manage Webhooks by default, 5 subcommands, valid size', async () => {
    const j = cmd.data.toJSON();
    assert(j.options.map((o) => o.name).join() === 'create,panel,list,delete,send', 'subs');
    assert(BigInt(j.default_member_permissions) === PermissionFlagsBits.ManageWebhooks, 'default permission');
  });
  await test('create: webhook appears with the bot avatar, the link is shown only to the author', async () => {
    const out = await run('create', { name: ' Новости ' });
    assert(created[0].name === 'Новости' && created[0].avatar === 'https://cdn/bot.png', JSON.stringify(created[0]));
    assert(out.includes('discord.com/api/webhooks/N1/tok') && out.includes('"flags":64'), out);
  });
  await test('create: own avatar is used when it is an image; a non-image or huge file is refused', async () => {
    await run('create', { name: 'A', avatar: { url: 'https://x/a.png', contentType: 'image/png', size: 1000 } });
    assert(created[1].avatar === 'https://x/a.png', 'image used');
    const bad = await run('create', { name: 'B', avatar: { url: 'https://x/a.exe', contentType: 'application/x-msdownload', size: 10 } });
    const big = await run('create', { name: 'C', avatar: { url: 'https://x/a.png', contentType: 'image/png', size: 9 * 1024 * 1024 } });
    assert(bad.includes('картинкой') && big.includes('картинкой') && created.length === 2, 'refused');
  });
  await test('no right for the member or for the bot: nothing is created', async () => {
    const n = created.length;
    assert((await run('create', { name: 'X' }, { can: false })).includes('Управлять вебхуками') && created.length === n, 'member');
    guild.botCan = false; assert((await run('create', { name: 'X' })).includes('У бота нет права') && created.length === n, 'bot'); guild.botCan = true;
  });
  await test('Discord errors become readable messages (limit of 15, missing access)', async () => {
    channel.fail = 'Maximum number of webhooks reached (15)'; assert((await run('create', { name: 'X' })).includes('уже 15'), 'limit');
    channel.fail = 'Missing Permissions'; assert((await run('create', { name: 'X' })).includes('не хватает прав'), 'perm'); channel.fail = null;
  });
  await test('list: only webhooks made by this bot, without the log webhook', async () => {
    const out = await run('list');
    assert(out.includes('discord.com/api/webhooks/1/tok') && !out.includes('webhooks/2/') && !out.includes('webhooks/LOG/'), out);
  });
  await test('delete: only own webhooks; foreign and log webhooks are protected', async () => {
    assert((await run('delete', { id: '2' })).includes('Такого вебхука нет') && (await run('delete', { id: 'LOG' })).includes('Такого вебхука нет') && !deleted.length, 'protected');
    assert((await run('delete', { id: '1' })).includes('удалён') && deleted.length === 1 && deleted[0][0] === '1', 'own deleted');
  });
  await test('send: posts through the webhook with a custom name, never pings @everyone', async () => {
    store = [hook('5', BOT)];
    const out = await run('send', { id: '5', text: '@everyone привет', username: 'Диктор', avatar_url: 'https://x/y.png' });
    assert(out.includes('Диктор') && sent[0][1].username === 'Диктор' && sent[0][1].avatarURL === 'https://x/y.png' && sent[0][1].allowedMentions.parse.length === 0, JSON.stringify(sent));
    assert((await run('send', { id: '5', text: 'x', avatar_url: 'javascript:1' })).includes('http') && sent.length === 1, 'bad avatar url');
  });

  // feature switch exists and is registered
  await test('the feature switch is registered; it is a beta feature, so it works once the server switches beta on', async () => {
    const { featureForCommand, isEnabled } = require('../bot/utils/features');
    const row = await db.GuildSettings.findByPk('WG1');
    assert(featureForCommand('webhook')?.key === 'webhooks' && !isEnabled(row, 'webhooks'), 'beta: off by default');
    row.betaEnabled = true; assert(isEnabled(row, 'webhooks'), 'on with beta');
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
