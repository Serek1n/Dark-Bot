// The message builder (panel → «Сообщения»): checks of what is sent, targets of this server only, sending and editing through
// a webhook or as the bot, drafts, schedules in a time zone and the bot's scheduler that posts them, the tools.
process.env.DATABASE_PATH = './data/test_messages.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-messages-0123456789';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', OTHER = '777000000000000002', CH = '800000000000000001', FORUM = '800000000000000002', THREAD = '800000000000000003', FOREIGN = '800000000000000009';
const HOOK = '900000000000000001', TOKEN = 'tok_' + 'a'.repeat(60), URLHOOK = '900000000000000002';
let access = { manageable: true, owner: true, permissions: '0' };
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.guildAccess = access; n(); } });
const channels = { [CH]: { id: CH, guild_id: G, type: 0, name: 'general' }, [FORUM]: { id: FORUM, guild_id: G, type: 15, name: 'forum' }, [THREAD]: { id: THREAD, guild_id: G, type: 11, parent_id: CH, name: 't' }, [FOREIGN]: { id: FOREIGN, guild_id: OTHER, type: 0 } };
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getUsers: async () => ({}), getGuildRoles: async () => [],
  getGuildChannels: async () => Object.values(channels).filter((c) => c.guild_id === G), getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: { get: async (u) => (u === `/guilds/${G}/webhooks` ? { data: [{ id: HOOK, name: 'News', channel_id: CH, application_id: process.env.DISCORD_CLIENT_ID, token: TOKEN }] } : u.startsWith('/channels/') ? { data: channels[u.split('/')[2]] } : { data: {} }) }
});
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '111111111111111111';
  const db = require('../db'); await db.init();
  const kit = require('../bot/modules/messageKit');
  const sched = require('../bot/modules/scheduledMessages');

  // Discord, as far as the builder needs it
  const calls = [];
  const err = (status, code) => { const e = new Error('discord'); e.response = { status, data: { code } }; return e; };
  const hooks = { [HOOK]: { id: HOOK, guild_id: G, channel_id: CH, token: TOKEN, name: 'News' }, [URLHOOK]: { id: URLHOOK, guild_id: G, channel_id: CH, token: TOKEN, name: 'Pasted' }, '900000000000000003': { id: '900000000000000003', guild_id: OTHER, channel_id: FOREIGN, token: TOKEN, name: 'Foreign' } };
  const sentMsgs = {};
  const reply = (where, body) => { const id = String(123400000000000000n + BigInt(calls.length)); sentMsgs[id] = { ...body, channel_id: where, id, author: { username: body.username || 'News' } }; return { data: { id, channel_id: where } }; };
  let everyonePerms = (1n << 10n) | (1n << 11n) | (1n << 16n); // what @everyone may do: see the channels, write, read the history
  Object.assign(kit._api.botApi, {
    get: async (u) => {
      calls.push(['bot.get', u]);
      let m = /^\/channels\/(\d+)$/.exec(u); if (m) { if (!channels[m[1]]) throw err(404, 10003); return { data: channels[m[1]] }; }
      m = /^\/webhooks\/(\d+)$/.exec(u); if (m) { if (!hooks[m[1]]) throw err(404, 10015); return { data: hooks[m[1]] }; }
      m = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(u); if (m) { if (!sentMsgs[m[2]]) throw err(404, 10008); return { data: sentMsgs[m[2]] }; }
      if (/^\/guilds\/\d+\/members\/\d+$/.test(u)) return { data: { roles: [] } };
      m = /^\/guilds\/(\d+)\/roles$/.exec(u); if (m) return { data: [{ id: m[1], permissions: String(everyonePerms), mentionable: false }, { id: '555000000000000001', permissions: '0', mentionable: true }] };
      return { data: {} };
    },
    post: async (u, body) => { calls.push(['bot.post', u, body]); const m = /^\/channels\/(\d+)\/(messages|threads)$/.exec(u); if (m[2] === 'threads') { const r = reply('T' + calls.length, body.message); return { data: { id: r.data.channel_id, message: { id: r.data.id } } }; } return reply(m[1], body); },
    patch: async (u, body) => { calls.push(['bot.patch', u, body]); const id = u.split('/').pop(); if (!sentMsgs[id]) throw err(404, 10008); Object.assign(sentMsgs[id], body); return { data: { id, channel_id: sentMsgs[id].channel_id } }; }
  });
  Object.assign(kit._api.plainApi, {
    get: async (u) => { calls.push(['hook.get', u]); const m = /^\/webhooks\/(\d+)\/([^/?]+)(?:\/messages\/(\d+))?/.exec(u); if (!hooks[m[1]]) throw err(404, 10015); if (m[3]) { if (!sentMsgs[m[3]]) throw err(404, 10008); return { data: sentMsgs[m[3]] }; } return { data: hooks[m[1]] }; },
    post: async (u, body) => { calls.push(['hook.post', u, body]); const m = /^\/webhooks\/(\d+)\//.exec(u); if (!hooks[m[1]]) throw err(404, 10015); return reply(hooks[m[1]].channel_id, body); },
    patch: async (u, body) => { calls.push(['hook.patch', u, body]); const id = /messages\/(\d+)/.exec(u)[1]; Object.assign(sentMsgs[id], body); return { data: { id, channel_id: sentMsgs[id].channel_id } }; }
  });
  const last = (kind) => calls.filter((c) => c[0] === kind).at(-1);

  await test('the message is checked with clear words: lengths, links, colours, empty parts, the 6000-character total', async () => {
    const bad = (m, re) => assert.throws(() => kit.cleanMessage(m), (e) => e.kit && re.test(e.message), JSON.stringify(m).slice(0, 80));
    bad({}, /Напишите текст или добавьте эмбед/);
    bad({ content: 'x'.repeat(2001) }, /2000/);
    bad({ embeds: [{ title: 'x'.repeat(257) }] }, /Эмбед 1: заголовок длиннее 256/);
    bad({ embeds: [{ title: 'a', color: 'red' }] }, /цвет/);
    bad({ embeds: [{ title: 'a', image: { url: 'http://x.y/a.png' } }] }, /картинка.*https/);
    bad({ embeds: [{}] }, /заполните хотя бы одно поле/);
    bad({ embeds: [{ title: 'a', fields: [{ name: 'n' }] }] }, /и название, и значение/);
    bad({ embeds: Array.from({ length: 4 }, () => ({ description: 'x'.repeat(1600) })) }, /6000/);
    bad({ content: 'a', username: 'Discord bot' }, /discord/);
    bad({ content: 'a', components: [{ components: [{ label: 'Go', url: 'javascript:alert(1)' }] }] }, /ссылка/);
    const ok = kit.cleanMessage({ content: 'hi', embeds: [{ title: 'T', color: '#e3a857', fields: [{ name: 'a', value: 'b', inline: 1 }, { name: '', value: '' }], timestamp: '2026-01-02T03:04:00Z' }], components: [{ components: [{ label: 'Сайт', url: 'https://example.com' }] }], mentions: 'weird' });
    assert.strictEqual(ok.embeds[0].color, 0xe3a857); assert.strictEqual(ok.embeds[0].fields.length, 1, 'the empty field row is dropped');
    assert.deepStrictEqual(ok.components, [{ type: 1, components: [{ type: 2, style: 5, label: 'Сайт', url: 'https://example.com' }] }]);
    assert.strictEqual(ok.mentions, 'none');
    assert.deepStrictEqual(kit.allowedMentions('none'), { parse: [] });
    assert.deepStrictEqual(kit.allowedMentions('everyone', false), { parse: ['users'], roles: [] }, '@everyone needs the right');
    assert.deepStrictEqual(kit.allowedMentions('roles', false, ['R1']), { parse: ['users'], roles: ['R1'] }, 'without the right only the mentionable roles are pinged');
    assert.deepStrictEqual(kit.allowedMentions('roles', true), { parse: ['users', 'roles'] }, 'with the right every role may be pinged');
  });

  await test('webhook links and message links are read; anything else is refused', async () => {
    assert.deepStrictEqual(kit.parseWebhookUrl(`https://discord.com/api/webhooks/${HOOK}/${TOKEN}`), { id: HOOK, token: TOKEN });
    assert.deepStrictEqual(kit.parseWebhookUrl(`https://canary.discord.com/api/v10/webhooks/${HOOK}/${TOKEN}?wait=true`), { id: HOOK, token: TOKEN });
    assert.strictEqual(kit.parseWebhookUrl(`https://evil.com/api/webhooks/${HOOK}/${TOKEN}`), null);
    assert.strictEqual(kit.parseWebhookUrl(`https://discord.com.evil.com/api/webhooks/${HOOK}/${TOKEN}`), null);
    assert.deepStrictEqual(kit.parseMessageRef(`https://discord.com/channels/${G}/${CH}/123456789012345678`), { guildId: G, channelId: CH, messageId: '123456789012345678' });
    assert.strictEqual(kit.parseMessageRef('hello'), null);
  });

  await test('schedule rules: time zones, weekdays, the 31st in a short month, every N hours, past dates', async () => {
    const at = (s) => Date.parse(s);
    const { rule, timezone } = sched.cleanRule({ kind: 'daily', time: '18:00' }, 'Europe/Moscow');
    assert.strictEqual(new Date(sched.nextRun(rule, timezone, at('2026-03-10T10:00:00Z'))).toISOString(), '2026-03-10T15:00:00.000Z', '18:00 in Moscow is 15:00 UTC');
    assert.strictEqual(new Date(sched.nextRun(rule, timezone, at('2026-03-10T16:00:00Z'))).toISOString(), '2026-03-11T15:00:00.000Z', 'today is past: tomorrow');
    const weekly = sched.cleanRule({ kind: 'weekly', time: '09:30', days: [1, 3] }, 'UTC');
    assert.strictEqual(new Date(sched.nextRun(weekly.rule, 'UTC', at('2026-03-10T12:00:00Z'))).toISOString(), '2026-03-11T09:30:00.000Z', 'Tuesday → Wednesday');
    const monthly = sched.cleanRule({ kind: 'monthly', time: '00:00', day: 31 }, 'UTC');
    assert.strictEqual(new Date(sched.nextRun(monthly.rule, 'UTC', at('2026-02-02T00:00:00Z'))).toISOString(), '2026-02-28T00:00:00.000Z', 'last day of February');
    const ny = sched.cleanRule({ kind: 'daily', time: '12:00' }, 'America/New_York');
    assert.strictEqual(new Date(sched.nextRun(ny.rule, ny.timezone, at('2026-07-01T00:00:00Z'))).toISOString(), '2026-07-01T16:00:00.000Z', 'summer time');
    assert.strictEqual(new Date(sched.nextRun(ny.rule, ny.timezone, at('2026-12-01T00:00:00Z'))).toISOString(), '2026-12-01T17:00:00.000Z', 'winter time');
    const hours = sched.cleanRule({ kind: 'hours', every: 6, start: '2026-01-01T00:00' }, 'UTC');
    assert.strictEqual(new Date(sched.nextRun(hours.rule, 'UTC', at('2026-01-01T07:00:00Z'))).toISOString(), '2026-01-01T12:00:00.000Z');
    const once = sched.cleanRule({ kind: 'once', dates: ['2026-05-01T10:00', '2026-04-01T10:00'] }, 'UTC');
    assert.strictEqual(new Date(sched.nextRun(once.rule, 'UTC', at('2026-04-15T00:00:00Z'))).toISOString(), '2026-05-01T10:00:00.000Z');
    assert.strictEqual(sched.nextRun(once.rule, 'UTC', at('2026-06-01T00:00:00Z')), null, 'all past');
    assert.throws(() => sched.cleanRule({ kind: 'daily', time: '18:00' }, 'Mars/Base'), /часовой пояс/);
    assert.throws(() => sched.cleanRule({ kind: 'weekly', time: '18:00', days: [] }, 'UTC'), /день недели/);
    assert.strictEqual(sched.describeRule(weekly.rule), 'по пн, ср в 09:30');
  });

  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.locals.termText = require('../bot/utils/duration').formatTerm;
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use((req, res, next) => { res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:"); next(); });
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}/messages`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const form = (p) => fetch(base + p, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual' }).then((r) => r.headers.get('location'));
  const msg = { content: 'Привет @everyone', embeds: [{ title: 'Новости', description: 'Текст', color: '#5865f2' }], components: [{ components: [{ label: 'Сайт', url: 'https://example.com' }] }], username: 'Робот', mentions: 'everyone' };

  await test('the builder is a part of the "Вебхуки" page (old address redirects); its data carries no webhook links', async () => {
    const old = await fetch(base, { redirect: 'manual' });
    assert(old.status === 301 && old.headers.get('location').endsWith(`/dashboard/${G}/webhooks#editor`), 'old /messages redirects');
    const r = await fetch(base.replace('/messages', '/webhooks')); const html = await r.text();
    assert.strictEqual(r.status, 200);
    for (const s of ['Вебхуки', 'Конструктор', 'Сохранённые', 'Расписание', 'Цветной текст', 'Информация о вебхуке', 'News · #general', '/js/messages.js', 'name="m-kind" value="v2"']) assert(html.includes(s), s);
    const data = /<script id="msg-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
    assert(!data.includes(TOKEN) && JSON.parse(data).page.endsWith('/webhooks'), 'no webhook token in the builder data');
    assert(/img-src 'self' https: data:/.test(r.headers.get('content-security-policy')), r.headers.get('content-security-policy'));
  });

  await test('send as the bot: into a channel of this server, pings off unless asked; never into another server', async () => {
    let r = await post('/send', { target: { mode: 'channel', channelId: CH }, message: { ...msg, mentions: 'none' } });
    assert(r.ok && r.url.endsWith(`/${CH}/${r.id}`), JSON.stringify(r));
    const p = last('bot.post'); assert.strictEqual(p[1], `/channels/${CH}/messages`); assert.deepStrictEqual(p[2].allowed_mentions, { parse: [] });
    assert(!('username' in p[2]), 'the bot has no other name');
    r = await post('/send', { target: { mode: 'channel', channelId: FOREIGN }, message: msg });
    assert(!r.ok && /не найден на этом сервере/.test(r.error), JSON.stringify(r));
    r = await post('/send', { target: { mode: 'channel', channelId: CH }, message: { content: '' } });
    assert(!r.ok && r.status === 400 && /Напишите текст/.test(r.error));
  });

  await test('forums need a post title; a thread ID must be a thread of this server', async () => {
    let r = await post('/send', { target: { mode: 'channel', channelId: FORUM }, message: { content: 'a' } });
    assert(!r.ok && /название новой публикации/.test(r.error), JSON.stringify(r));
    r = await post('/send', { target: { mode: 'channel', channelId: FORUM, threadName: 'Тема' }, message: { content: 'a' } });
    assert(r.ok && last('bot.post')[1] === `/channels/${FORUM}/threads` && last('bot.post')[2].name === 'Тема');
    r = await post('/send', { target: { mode: 'channel', channelId: CH, threadId: THREAD }, message: { content: 'a' } });
    assert(r.ok && last('bot.post')[1] === `/channels/${THREAD}/messages`);
    r = await post('/send', { target: { mode: 'channel', channelId: CH, threadId: FOREIGN }, message: { content: 'a' } });
    assert(!r.ok && /Ветка не найдена/.test(r.error));
  });

  await test('webhooks: the bot\'s own one or a pasted link of THIS server; name, avatar, link buttons, @everyone for those allowed', async () => {
    let r = await post('/send', { target: { mode: 'webhook', webhookId: HOOK, threadId: THREAD }, message: msg });
    assert(r.ok, JSON.stringify(r));
    let p = last('hook.post'); assert(p[1].startsWith(`/webhooks/${HOOK}/${TOKEN}?`) && /wait=true/.test(p[1]) && /with_components=true/.test(p[1]) && p[1].includes(`thread_id=${THREAD}`), p[1]);
    assert(p[2].username === 'Робот' && p[2].components[0].components[0].style === 5);
    assert.deepStrictEqual(p[2].allowed_mentions, { parse: ['users', 'roles', 'everyone'] }, 'the owner may ping everyone');
    r = await post('/send', { target: { mode: 'webhook', url: `https://discord.com/api/webhooks/${URLHOOK}/${TOKEN}` }, message: { content: 'x' } });
    assert(r.ok && last('hook.post')[1].startsWith(`/webhooks/${URLHOOK}/`));
    r = await post('/send', { target: { mode: 'webhook', url: `https://discord.com/api/webhooks/900000000000000003/${TOKEN}` }, message: { content: 'x' } });
    assert(!r.ok && /другому серверу/.test(r.error), 'a webhook of another server');
    r = await post('/send', { target: { mode: 'webhook', url: 'https://example.com/hook' }, message: { content: 'x' } });
    assert(!r.ok && /не ссылка вебхука/.test(r.error));
    access = { manageable: true, owner: false, permissions: String(1n << 5n) }; // "Manage Server" only
    try {
      r = await post('/send', { target: { mode: 'webhook', webhookId: HOOK }, message: { content: 'x' } });
      assert(r.status === 403 && /Управлять вебхуками/.test(r.error), JSON.stringify(r));
      r = await post('/send', { target: { mode: 'channel', channelId: CH }, message: msg });
      { const am = last('bot.post')[2].allowed_mentions; assert.deepStrictEqual(am.parse, ['users'], 'no @everyone without the right'); assert(Array.isArray(am.roles), 'roles are listed one by one'); }
      const html = await (await fetch(base.replace('/messages', '/webhooks'))).text();
      assert(!html.includes('News · #general') && html.includes('Нужно право «Управлять вебхуками»') && html.includes('только тот, у кого есть право «Управлять вебхуками»'), 'no webhooks offered, the builder still works');
    } finally { access = { manageable: true, owner: true, permissions: '0' }; }
  });

  await test('the bot is not a way around channel permissions: a manager needs his own rights in the channel; journals and the log webhook are closed', async () => {
    const actor = { userId: '800000000000000099', access: { manageable: true, owner: false, permissions: String(1n << 5n) } }; // "Manage Server" only
    const keep = everyonePerms;
    const refused = async (opts, re, why) => { const e = await kit.resolveTarget(G, { mode: 'channel', channelId: CH }, { actor, ...opts }).then(() => null, (x) => x); assert(e && e.code === 'forbidden' && re.test(e.message), why + ': ' + (e && e.message)); };
    await db.GuildSettings.findOrCreate({ where: { guildId: G } });
    try {
      assert((await kit.resolveTarget(G, { mode: 'channel', channelId: CH }, { actor })).kind === 'channel', 'sees the channel and may write');
      assert((await kit.resolveTarget(G, { mode: 'channel', channelId: CH }, { actor: { userId: actor.userId, access: { owner: true } }, need: 'edit' })).kind === 'channel', 'the owner may everything');
      await refused({ need: 'edit' }, /Управлять сообщениями/, 'editing the bot\'s message needs Manage Messages there');
      everyonePerms = (1n << 10n) | (1n << 16n); // sees, may not write
      await refused({}, /писать/, 'no right to write');
      everyonePerms = 0n; // a channel he does not see
      await refused({}, /нет доступа/, 'hidden channel');
      await refused({ need: 'read' }, /нет доступа/, 'a message of a hidden channel is not read');
      everyonePerms = keep | (1n << 13n); // may manage messages...
      await db.GuildSettings.update({ modLogChannelId: CH }, { where: { guildId: G } });
      await refused({ need: 'edit' }, /журнал/, '...but records of a journal channel stay as they are');
      await db.GuildSettings.update({ modLogChannelId: null, logWebhookId: HOOK }, { where: { guildId: G } });
      const e = await kit.resolveTarget(G, { mode: 'webhook', webhookId: HOOK }).then(() => null, (x) => x);
      assert(e && /служебный вебхук/.test(e.message), 'the log webhook is not a target');
      // the route passes the person who presses the button
      const before = access; access = actor.access; everyonePerms = 0n;
      try { const r = await post('/send', { target: { mode: 'channel', channelId: CH }, message: { content: 'x' } }); assert(r.status === 403, 'route refuses: ' + JSON.stringify(r)); } finally { access = before; }
    } finally { everyonePerms = keep; await db.GuildSettings.update({ modLogChannelId: null, logWebhookId: null }, { where: { guildId: G } }); }
  });
  await test('edit and restore: load a sent message (by ID or link) into the editor, change it in place', async () => {
    const sent = await post('/send', { target: { mode: 'webhook', webhookId: HOOK }, message: { content: 'v1', embeds: [{ title: 'A', fields: [{ name: 'n', value: 'v' }] }], components: [{ components: [{ label: 'L', url: 'https://a.b' }] }] } });
    let r = await post('/load', { target: { mode: 'webhook', webhookId: HOOK }, messageRef: sent.id });
    assert(r.ok && r.message.content === 'v1' && r.message.embeds[0].fields[0].name === 'n' && r.message.components[0].components[0].label === 'L', JSON.stringify(r));
    r = await post('/send', { target: { mode: 'webhook', webhookId: HOOK }, messageRef: sent.url, message: { content: 'v2', username: 'Nope' } });
    assert(r.ok && r.edited && last('hook.patch')[1].includes(`/messages/${sent.id}`) && !('username' in last('hook.patch')[2]), 'edit keeps the author');
    const bot = await post('/send', { target: { mode: 'channel', channelId: CH }, message: { content: 'b1' } });
    r = await post('/load', { target: { mode: 'channel', channelId: CH }, messageRef: `https://discord.com/channels/${G}/${CH}/${bot.id}` });
    assert(r.ok && r.message.content === 'b1');
    r = await post('/load', { target: { mode: 'channel', channelId: CH }, messageRef: `https://discord.com/channels/${OTHER}/${CH}/${bot.id}` });
    assert(!r.ok && /этого сервера/.test(r.error), 'a link to another server');
    r = await post('/load', { target: { mode: 'channel', channelId: CH }, messageRef: '123456789012345678' });
    assert(!r.ok && /Сообщение не найдено/.test(r.error), JSON.stringify(r));
  });

  await test('drafts: saved without the webhook link, opened again, updated, deleted; another server cannot read them', async () => {
    let r = await post('/saved', { name: 'Правила', state: { message: { content: 'rules' }, target: { mode: 'webhook', url: `https://discord.com/api/webhooks/${URLHOOK}/${TOKEN}` } } });
    assert(r.ok, JSON.stringify(r));
    const row = await db.SavedMessage.findByPk(r.id); assert(!row.data.includes(TOKEN), 'the link is not stored');
    const got = await (await fetch(`${base}/saved/${r.id}`)).json(); assert(got.ok && got.state.message.content === 'rules');
    assert.strictEqual((await post('/saved', { id: r.id, name: 'Правила 2', state: { message: { content: 'new' } } })).id, r.id);
    assert.strictEqual((await db.SavedMessage.findByPk(r.id)).name, 'Правила 2');
    assert(!(await post('/saved', { name: 'x', state: { message: {} } })).ok, 'an empty message is not kept');
    const foreign = await db.SavedMessage.create({ guildId: OTHER, name: 'secret', data: '{}' });
    assert.strictEqual((await fetch(`${base}/saved/${foreign.id}`)).status, 404);
    await form(`/saved/${foreign.id}/delete`); assert(await db.SavedMessage.findByPk(foreign.id), 'another server\'s draft stays');
    assert((await form(`/saved/${r.id}/delete`)).includes('deleted')); assert(!(await db.SavedMessage.findByPk(r.id)));
  });

  await test('schedule: saved with the next time, the pasted link encrypted; the bot posts when due and moves on; gone webhooks stop it', async () => {
    const url = `https://discord.com/api/webhooks/${URLHOOK}/${TOKEN}`;
    let r = await post('/schedule', { name: 'Каждый день', message: { content: 'daily', embeds: [{ title: 'T' }] }, target: { mode: 'webhook', url }, rule: { kind: 'daily', time: '18:00' }, timezone: 'Europe/Moscow' });
    assert(r.ok && new Date(r.nextRunAt) > new Date(), JSON.stringify(r));
    const row = await db.ScheduledMessage.findByPk(r.id);
    assert(row.webhookUrl.startsWith('enc:v1:') && !row.webhookUrl.includes(TOKEN) && !row.target.includes(TOKEN), 'encrypted');
    const edit = await (await fetch(`${base}/schedule/${r.id}`)).json();
    assert(edit.ok && edit.hasUrl && edit.target.url === '' && !JSON.stringify(edit).includes(TOKEN), 'the link never goes back to the page');
    assert((await post('/schedule', { id: r.id, name: 'Каждый день', message: { content: 'daily 2' }, target: { mode: 'webhook' }, rule: { kind: 'daily', time: '19:00' }, timezone: 'UTC' })).ok, 'saved again without retyping the link');
    await row.reload(); assert(row.webhookUrl.startsWith('enc:v1:') && row.timezone === 'UTC');
    assert(!(await post('/schedule', { name: 'old', message: { content: 'x' }, target: { mode: 'channel', channelId: CH }, rule: { kind: 'once', dates: ['2020-01-01T10:00'] } })).ok, 'all past');
    // due now: the bot sends it and sets the next time BEFORE sending
    await row.update({ nextRunAt: new Date(Date.now() - 1000) });
    const before = calls.length;
    await sched.tick();
    await row.reload();
    const p = calls.slice(before).find((c) => c[0] === 'hook.post');
    assert(p && p[2].content === 'daily 2' && row.runs === 1 && row.enabled && new Date(row.nextRunAt) > new Date() && !row.lastError, JSON.stringify(row.toJSON()));
    // once: posted, then switched off
    const once = await db.ScheduledMessage.create({ guildId: G, name: 'o', data: JSON.stringify({ content: 'once' }), target: JSON.stringify({ mode: 'channel', channelId: CH }), rule: JSON.stringify({ kind: 'once', dates: ['2020-01-01T10:00'] }), timezone: 'UTC', nextRunAt: new Date(Date.now() - 1000) });
    await sched.tick(); await once.reload();
    assert(once.runs === 1 && !once.enabled && once.nextRunAt === null);
    // the webhook was deleted: the error is noted and the entry stops
    delete hooks[URLHOOK];
    await row.update({ nextRunAt: new Date(Date.now() - 1000) });
    await sched.tick(); await row.reload();
    assert(!row.enabled && /не найден/.test(row.lastError), JSON.stringify(row.toJSON()));
    assert((await form(`/schedule/${row.id}/test`)).includes('msgfail'));
    assert((await form(`/schedule/${once.id}/toggle`)).includes('msgpast'), 'nothing left to send');
    assert((await form(`/schedule/${once.id}/test`)).includes('msgtest'));
    const page = await (await fetch(base.replace('/messages', '/webhooks'))).text(); assert(page.includes('Последняя ошибка') && page.includes('каждый день в 19:00'), 'listed');
    assert((await form(`/schedule/${row.id}/delete`)).includes('deleted') && !(await db.ScheduledMessage.findByPk(row.id)));
  });

  await test('Discord components: checked by Discord\'s rules, sent with the components flag, loaded back for editing', async () => {
    const v2 = { v2: true, components: [{ type: 17, accent_color: '#e3a857', components: [{ type: 10, content: '## Новости' }, { type: 14, divider: true, spacing: 2 }, { type: 12, items: [{ media: { url: 'https://img.example/a.png' }, description: 'Картинка' }] }, { type: 9, components: [{ type: 10, content: 'Подробнее' }], accessory: { type: 2, style: 5, label: 'Сайт', url: 'https://example.com' } }] }, { type: 1, components: [{ type: 2, style: 5, label: 'Правила', url: 'https://example.com/r' }] }] };
    let r = await post('/send', { target: { mode: 'webhook', webhookId: HOOK }, message: { ...v2, username: 'Новости' } });
    assert(r.ok, JSON.stringify(r));
    const p = last('hook.post');
    assert(p[2].flags === 32768 && !('content' in p[2]) && !('embeds' in p[2]) && p[2].components[0].type === 17 && p[2].components[0].accent_color === 0xe3a857 && p[2].username === 'Новости', JSON.stringify(p[2]).slice(0, 200));
    assert(/with_components=true/.test(p[1]));
    sentMsgs[r.id].flags = 32768;
    const back = await post('/load', { target: { mode: 'webhook', webhookId: HOOK }, messageRef: r.id });
    assert(back.ok && back.message.v2 && back.message.components[0].type === 17, JSON.stringify(back).slice(0, 200));
    const bad = async (components, re) => assert.throws(() => kit.cleanMessage({ v2: true, components }), (e) => e.kit && re.test(e.message), JSON.stringify(components).slice(0, 60));
    await bad([], /хотя бы один блок/);
    await bad([{ type: 17, components: [] }], /контейнер пустой/);
    await bad([{ type: 17, components: [{ type: 17, components: [{ type: 10, content: 'x' }] }] }], /не поддерживается/);
    await bad([{ type: 12, items: [{ media: { url: 'http://insecure/a.png' } }] }], /https/);
    await bad(Array.from({ length: 41 }, () => ({ type: 10, content: 'a' })), /больше 40/);
    await bad([{ type: 10, content: 'x'.repeat(2500) }, { type: 10, content: 'y'.repeat(2000) }], /больше 4000/);
    r = await post('/saved', { name: 'Компоненты', state: { message: v2 } });
    assert(r.ok, 'a draft with components is kept');
  });

  await test('webhook info: name, server and channel, never the token; bad links refused', async () => {
    hooks[URLHOOK] = { id: URLHOOK, guild_id: G, channel_id: CH, token: TOKEN, name: 'Pasted', application_id: '1' };
    const r = await post('/webhook-info', { url: `https://discord.com/api/webhooks/${URLHOOK}/${TOKEN}` });
    assert(r.ok && r.info.name === 'Pasted' && r.info.sameGuild && !JSON.stringify(r).includes(TOKEN) && /^20\d\d-/.test(r.info.createdAt), JSON.stringify(r));
    assert(!(await post('/webhook-info', { url: 'https://example.com' })).ok);
  });

  await test('the bot starts the scheduler when it is ready', async () => {
    assert(fs.readFileSync(path.join(__dirname, '..', 'bot', 'events', 'ready.js'), 'utf8').includes("startScheduledMessages()"));
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
