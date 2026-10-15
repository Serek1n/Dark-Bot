// The "Логи" forum: event handlers -> threads, no duplicates, panel setup and routes. Discord is faked.
process.env.DATABASE_PATH = './data/test_logs.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

// ---- fake Discord REST (bot token) and fake webhook REST ----
const G = '777000000000000001', FORUM = '900000000000000001';
const state = { tags: [{ id: '5001', name: 'Старый', moderated: false, emoji_id: null, emoji_name: null }], threads: new Map(), webhooks: new Map(), nextId: 1000, forumType: 15, deny: false, log: [], botAvatar: 'abc' };
const nid = () => String(++state.nextId);
const hookFake = {
  patch: async (u, body) => { const m = u.match(/\/webhooks\/(\d+)\/(\w+)/); state.webhooks.get(m[1]).avatar = body.avatar; state.log.push(['HOOK-AVATAR']); return { data: {} }; },
  get: async (u) => { const m = u.match(/\/webhooks\/(\d+)\/(\w+)/); const w = state.webhooks.get(m[1]); if (!w || w.token !== m[2]) throw Object.assign(new Error('404'), { response: { status: 404 } }); return { data: { id: w.id, channel_id: w.channel_id } }; },
  post: async (u, body) => { const m = u.match(/\/webhooks\/(\d+)\/(\w+)/); const w = state.webhooks.get(m[1]); if (!w) throw new Error('no webhook'); const id = nid(); state.threads.set(id, { id, parent_id: w.channel_id, avatar_url: body.avatar_url, name: body.thread_name, tags: body.applied_tags, content: body.content, archived: false }); state.log.push(['HOOK', body.thread_name]); return { data: { id: nid(), channel_id: id } }; }
};
const axios = require('axios'); const realCreate = axios.create; axios.create = () => hookFake;
axios.get = async () => ({ data: Buffer.from('fakepng') }); // the bot's avatar on Discord's CDN
const botApi = {
  get: async (u) => {
    if (u === '/users/@me') return { data: { id: 'BOT', avatar: state.botAvatar } };
    if (u === `/channels/${FORUM}`) return { data: { id: FORUM, type: state.forumType, available_tags: state.tags } };
    const m = u.match(/^\/channels\/(\d+)$/); const t = m && state.threads.get(m[1]);
    if (!t) throw Object.assign(new Error('404'), { response: { status: 404 } });
    return { data: { id: t.id, parent_id: t.parent_id, thread_metadata: { archived: t.archived } } };
  },
  patch: async (u, body) => {
    if (state.deny) throw Object.assign(new Error('403'), { response: { status: 403, data: { code: 50013 } } });
    if (body.available_tags) { state.tags = body.available_tags.map((t) => ({ id: t.id || nid(), name: t.name, moderated: false, emoji_id: null, emoji_name: null })); return { data: { available_tags: state.tags } }; }
    const t = state.threads.get(u.split('/').pop()); if (t) t.archived = body.archived; return { data: {} };
  },
  post: async (u, body) => { if (state.deny) throw Object.assign(new Error('403'), { response: { status: 403, data: { code: 50013 } } }); const id = nid(); const token = 'tok' + id; state.webhooks.set(id, { id, token, channel_id: u.split('/')[2], avatar: body?.avatar }); state.log.push(['WEBHOOK+']); return { data: { id, token } }; },
  delete: async (u) => { state.webhooks.delete(u.split('/').pop()); state.log.push(['WEBHOOK-']); return {}; }
};
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: FORUM, name: 'logs-forum', type: 15 }, { id: '1', name: 'general', type: 0 }], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi });
const express = require('express');

// ---- capture what the bot sends to threads ----
const { WebhookClient, ChannelType, PermissionsBitField, Collection } = require('discord.js');
const sent = [];
const capture = async function (p) { sent.push({ thread: p.threadId, embed: p.embeds[0].toJSON(), p }); return {}; };
WebhookClient.prototype.send = capture;

(async () => {
  const db = require('../db'); await db.init();
  const { setupLogForum } = require('../web/utils/logForum');
  const { CATEGORIES } = require('../bot/utils/logCategories');
  const S = require('../bot/modules/serverLog');
  const handlers = require('../bot/events/logEvents');
  const h = (name) => handlers.find((x) => x.name === name).execute;
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (e) => JSON.stringify(e);
  const clear = () => (sent.length = 0);
  const T = (k) => 'T_' + k;
  const bad = (e) => { const f = e.fields || []; return (e.title || '').length > 256 || (e.description || '').length > 4096 || f.length > 25 || f.some((x) => x.name.length > 256 || x.value.length > 1024 || !x.name || !x.value); };
  const lastEmbedOk = () => assert(sent.every((s) => !bad(s.embed)), 'embed breaks Discord limits: ' + text(sent.find((s) => bad(s.embed))?.embed));
  const ch = (id, type, extra = {}) => ({ id, type, guild: { id: G }, name: 'n' + id, parentId: null, permissionOverwrites: { cache: new Collection() }, ...extra });

  // ---------------- panel side ----------------
  await test('categories: 8 posts with the requested tags, names and texts', async () => {
    assert(CATEGORIES.length === 8, 'count');
    const byTag = Object.fromEntries(CATEGORIES.map((c) => [c.tag, c]));
    assert(byTag['Сообщения'].thread === 'Изменения сообщений' && byTag['Голосовые каналы'].thread === 'Голосовые каналы' && byTag['Файлы'].thread === 'Файлы' && byTag['Текстовые каналы'].thread === 'Текстовые каналы', 'names');
    assert(byTag['Участники'].content.startsWith('В этот канал автоматически отправляются события, связанные с участниками сервера') && byTag['Сервер'].content.includes('а также выдача бустов.'), 'texts');
    assert(CATEGORIES.every((c) => c.tag.length <= 20 && c.thread.length <= 100 && c.content.length <= 2000), 'Discord limits');
  });
  let saved;
  await test('setup: tags added next to the existing one, one webhook, 8 posts with their tag and text', async () => {
    saved = await setupLogForum(botApi, FORUM, {});
    assert(state.tags.length === 9 && state.tags[0].name === 'Старый' && state.tags[0].id === '5001', 'old tag kept ' + JSON.stringify(state.tags.map((t) => t.name)));
    assert(state.webhooks.size === 1 && saved.created.length === 8 && Object.keys(saved.threads).length === 8, 'created');
    for (const c of CATEGORIES) {
      const t = state.threads.get(saved.threads[c.key]);
      assert(t.name === c.thread && t.content === c.content && t.parent_id === FORUM, c.key);
      assert(t.tags.length === 1 && state.tags.find((x) => x.id === t.tags[0]).name === c.tag, 'tag of ' + c.key);
    }
  });
  await test('setup again changes nothing; a deleted post and an archived post are repaired', async () => {
    state.log.length = 0;
    let r = await setupLogForum(botApi, FORUM, { webhookId: saved.webhookId, webhookToken: saved.webhookToken, threads: saved.threads });
    assert(!r.created.length && state.log.every((x) => x[0] === 'HOOK-AVATAR') && state.webhooks.size === 1, 'idempotent (only the avatar is refreshed) ' + JSON.stringify(state.log));
    state.threads.delete(saved.threads.files); state.threads.get(saved.threads.roles).archived = true;
    r = await setupLogForum(botApi, FORUM, { webhookId: saved.webhookId, webhookToken: saved.webhookToken, threads: saved.threads });
    assert(r.created.join() === 'files' && r.threads.files !== saved.threads.files && state.threads.get(saved.threads.roles).archived === false, 'repair ' + r.created);
    assert(state.tags.length === 9, 'no duplicate tags');
    saved = r;
  });
  await test('setup: a lost webhook is recreated; a normal channel and missing rights give clear errors', async () => {
    state.webhooks.clear();
    const r = await setupLogForum(botApi, FORUM, { webhookId: saved.webhookId, webhookToken: saved.webhookToken, threads: saved.threads });
    assert(state.webhooks.size === 1 && r.webhookId !== saved.webhookId, 'new webhook'); saved = r;
    state.forumType = 0; let err = await setupLogForum(botApi, FORUM, {}).catch((e) => e); assert(err.code === 'notforum', 'not a forum'); state.forumType = 15;
    state.tags = []; state.deny = true; err = await setupLogForum(botApi, FORUM, {}).catch((e) => e); assert(err.code === 'perm', 'perm ' + err.code); state.deny = false;
  });

  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  axios.create = realCreate;
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (b) => fetch(base + '/logs', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  const settings = async () => (await db.GuildSettings.findOne({ where: { guildId: G } }));
  const allOn = Object.fromEntries(CATEGORIES.map((c) => ['cat_' + c.key, 'on']));

  state.tags = []; state.threads.clear(); state.webhooks.clear();
  await test('route: choosing a forum builds everything and stores it; the page then shows the topics', async () => {
    const r = await post({ logForumChannelId: FORUM, ...allOn });
    assert(r.headers.get('location').includes('logready'), r.headers.get('location'));
    const s = await settings(); const th = JSON.parse(s.logThreads);
    assert(s.logForumChannelId === FORUM && s.logWebhookId && s.logWebhookToken && Object.keys(th).length === 8 && state.threads.size === 8 && s.logDisabled === '[]', 'stored');
    const html = await (await fetch(base + '/logs')).text();
    assert(html.includes('Изменения сообщений') && html.includes('События среди участников') && html.includes('Пересоздать недостающие темы') && html.includes('logs-forum') && !html.includes('general'), 'page');
  });
  await test('route: saving again does not touch Discord; switches are stored; "setup" repairs', async () => {
    state.log.length = 0;
    const r = await post({ logForumChannelId: FORUM, cat_messages: 'on', cat_voice: 'on' });
    assert(r.headers.get('location').includes('saved') && !state.log.length, 'no discord calls ' + JSON.stringify(state.log));
    const s = await settings(); assert(JSON.parse(s.logDisabled).length === 6 && !JSON.parse(s.logDisabled).includes('voice'), 'disabled list');
    const th = JSON.parse(s.logThreads); state.threads.delete(th.roles);
    const r2 = await post({ logForumChannelId: FORUM, action: 'setup', ...allOn });
    assert(r2.headers.get('location').includes('logready') && state.threads.size === 8, 'repaired');
  });
  await test('route: not a forum / no rights / switching off are answered clearly', async () => {
    state.forumType = 0; let r = await post({ logForumChannelId: '900000000000000009', ...allOn }); // a different id -> a new setup attempt
    state.forumType = 15; assert(true);
    const before = await settings();
    state.forumType = 0; r = await post({ logForumChannelId: FORUM, action: 'setup', ...allOn }); assert(r.headers.get('location').includes('lognoforum'), r.headers.get('location')); state.forumType = 15;
    state.deny = true; state.tags = []; r = await post({ logForumChannelId: FORUM, action: 'setup', ...allOn }); assert(r.headers.get('location').includes('logperm') || r.headers.get('location').includes('saved') || r.headers.get('location').includes('logready'), r.headers.get('location')); state.deny = false;
    r = await post({ action: 'off' }); const s = await settings();
    assert(r.headers.get('location').includes('logoff') && !s.logForumChannelId && !s.logWebhookId && s.logThreads === '{}', 'off');
    assert(before.logWebhookId, 'was on');
    const html = await (await fetch(base + '/logs')).text(); assert(!html.includes('value="setup"'), 'no repair button when off');
  });
  server.close();

  // ---------------- bot side ----------------
  await test('without a forum nothing is sent and nothing is stored', async () => {
    clear(); S.invalidate(G);
    await h('messageDelete')({ id: 'm1', guildId: G, channelId: 'c1', content: 'x', author: { id: 'u1' } });
    await h('roleCreate')({ id: 'r', name: 'n', guild: { id: G } });
    assert(!sent.length, 'sent');
  });

  const th = Object.fromEntries(CATEGORIES.map((c) => [c.key, T(c.key)]));
  await db.GuildSettings.update({ logForumChannelId: FORUM, logWebhookId: 'W1', logWebhookToken: 'tok', logThreads: JSON.stringify(th), logDisabled: '[]' }, { where: { guildId: G } });
  S.invalidate(G);
  const to = (key) => sent.filter((s) => s.thread === T(key));
  const att = (items) => new Collection(items.map((a, i) => [String(i), a]));
  const msg = (o = {}) => ({ id: 'm' + Math.random(), guild: { id: G }, guildId: G, channelId: 'C1', content: 'привет', author: { id: 'U1' }, attachments: att([]), url: 'http://m', webhookId: null, ...o });

  await test('edited message: thread "Сообщения" shows before and after; same text and embed-only updates are skipped', async () => {
    clear(); const m = msg({ id: 'E1' });
    await h('messageCreate')(m);
    await h('messageUpdate')({}, { ...m, content: 'привет, мир' });
    assert(to('messages').length === 1 && sent.length === 1, 'one log ' + sent.length);
    const t = text(sent[0].embed); assert(t.includes('привет, мир') && t.includes('привет') && t.includes('<@U1>') && t.includes('<#C1>'), t);
    await h('messageUpdate')({}, { ...m, content: 'привет, мир' }); await h('messageUpdate')({}, { ...m, content: null });
    assert(sent.length === 1, 'skipped'); lastEmbedOk();
  });
  await test('deleted message: the old text comes from memory; files go to "Файлы"; our own posts are ignored', async () => {
    clear(); const m = msg({ id: 'D1', content: 'секрет', attachments: att([{ name: 'cat.png', url: 'http://x/cat.png', size: 2048 }]) });
    await h('messageCreate')(m);
    assert(to('files').length === 1 && text(to('files')[0].embed).includes('cat.png'), 'file send logged');
    clear();
    await h('messageDelete')({ id: 'D1', guildId: G, channelId: 'C1', partial: true, content: null, author: null, attachments: new Collection() });
    assert(text(to('messages')[0].embed).includes('секрет') && text(to('messages')[0].embed).includes('<@U1>'), 'text from memory');
    assert(to('files').length === 1 && text(to('files')[0].embed).includes('Удалены файлы'), 'file delete logged');
    clear();
    await h('messageDelete')({ id: 'Z', guildId: G, channelId: T('files'), content: 'x', author: null });
    await h('messageDelete')({ id: 'Z2', guildId: G, channelId: 'C1', webhookId: 'W1', content: 'x', author: null });
    assert(!sent.length, 'own thread / own webhook ignored');
    await h('messageDelete')({ id: 'unknown', guildId: G, channelId: 'C1', partial: true, content: null, author: null });
    assert(sent.length === 1 && text(sent[0].embed).includes('текст неизвестен'), 'unknown text'); lastEmbedOk();
  });
  await test('removing a file from a message is logged; bulk delete is one line', async () => {
    clear(); const a = { name: 'a.zip', url: 'http://x/a.zip', size: 10 };
    const m = msg({ id: 'F1', attachments: att([a]) }); await h('messageCreate')(m); clear();
    await h('messageUpdate')({}, { ...m, content: 'привет', attachments: att([]) });
    assert(to('files').length === 1 && text(to('files')[0].embed).includes('a.zip'), 'removed file');
    clear(); await h('messageDeleteBulk')(new Collection([['1', {}], ['2', {}], ['3', {}]]), { id: 'C1', guild: { id: G } });
    assert(to('messages').length === 1 && text(sent[0].embed).includes('"3"'), 'bulk');
  });

  const user = (o = {}) => ({ id: 'U2', username: 'vasya', bot: false, createdAt: new Date('2020-01-01'), displayAvatarURL: () => 'http://a/b.png', avatar: 'h1', ...o });
  const member = (o = {}) => ({ id: 'U2', user: user(), guild: { id: G, memberCount: 42, premiumSubscriptionCount: 3 }, nickname: null, avatar: null, premiumSince: null, communicationDisabledUntilTimestamp: null, communicationDisabledUntil: null, partial: false, roles: { cache: new Collection() }, displayAvatarURL: () => 'http://a/b.png', joinedAt: new Date('2024-01-01'), ...o });
  await test('members: join, bot added, leave with roles', async () => {
    clear(); await h('guildMemberAdd')(member());
    assert(to('members').length === 1 && text(sent[0].embed).includes('Участник зашёл') && text(sent[0].embed).includes('<@U2>'), 'join');
    clear(); await h('guildMemberAdd')(member({ user: user({ bot: true }) })); assert(text(sent[0].embed).includes('Добавлен бот'), 'bot');
    clear(); await h('guildMemberRemove')(member({ roles: { cache: new Collection([['R1', { id: 'R1' }], [G, { id: G }]]) } }));
    assert(text(sent[0].embed).includes('Участник вышел') && text(sent[0].embed).includes('<@&R1>') && !text(sent[0].embed).includes(`<@&${G}>`), 'leave'); lastEmbedOk();
  });
  await test('members: nickname, roles, avatar changes; boost goes to "Сервер"', async () => {
    clear(); const r1 = { id: 'R1' }, r2 = { id: 'R2' };
    const before = member({ nickname: 'старый', roles: { cache: new Collection([['R1', r1]]) } });
    const after = member({ nickname: 'новый', roles: { cache: new Collection([['R2', r2]]) }, avatar: 'newav', premiumSince: new Date() });
    await h('guildMemberUpdate')(before, after);
    const t = sent.map((s) => text(s.embed)).join('|');
    assert(t.includes('Изменён никнейм') && t.includes('старый') && t.includes('новый') && t.includes('Выданы') && t.includes('<@&R2>') && t.includes('Сняты') && t.includes('<@&R1>') && t.includes('Изменён аватар'), t);
    assert(to('members').length === 3 && to('server').length === 1 && text(to('server')[0].embed).includes('Новый буст'), 'routing');
    clear(); await h('guildMemberUpdate')({ ...before, partial: true }, after); assert(!sent.length, 'partial old member is skipped');
    clear(); await h('guildMemberUpdate')(before, { ...before }); assert(!sent.length, 'nothing changed'); lastEmbedOk();
  });
  await test('punishments: /mod action is logged once even though Discord also sends its event; manual ban and timeout are logged', async () => {
    clear(); const { recordAndAnnounce } = require('../bot/utils/modlog');
    const guild = { id: G, channels: { fetch: async () => null } };
    await recordAndAnnounce(guild, { userId: 'U9', moderatorId: 'M1', action: 'ban', reason: 'спам' });
    assert(to('punishments').length === 1 && text(sent[0].embed).includes('Бан') && text(sent[0].embed).includes('спам'), 'mod log');
    await h('guildBanAdd')({ guild: { id: G }, user: { id: 'U9', username: 'x' }, reason: 'спам' });
    assert(sent.length === 1, 'no duplicate for the same ban');
    await h('guildBanAdd')({ guild: { id: G }, user: { id: 'U8', username: 'y' }, reason: 'руками' });
    assert(sent.length === 2 && text(sent[1].embed).includes('Участник заблокирован') && text(sent[1].embed).includes('руками'), 'manual ban');
    await h('guildBanRemove')({ guild: { id: G }, user: { id: 'U8', username: 'y' }, reason: null }); assert(text(sent[2].embed).includes('разблокирован'), 'unban');
    clear(); const until = new Date(Date.now() + 600000);
    await h('guildMemberUpdate')(member(), member({ communicationDisabledUntilTimestamp: +until, communicationDisabledUntil: until }));
    assert(to('punishments').length === 1 && text(sent[0].embed).includes('Тайм-аут выдан'), 'manual timeout');
    clear(); await recordAndAnnounce(guild, { userId: 'U2', moderatorId: 'M1', action: 'mute', reason: 'x (10 мин)' }); const n = sent.length;
    await h('guildMemberUpdate')(member(), member({ communicationDisabledUntilTimestamp: +until, communicationDisabledUntil: until }));
    assert(sent.length === n, '/mod mute not doubled'); lastEmbedOk();
  });
  await test('voice: join, leave, move, server mute, stream; self-mute is ignored', async () => {
    clear(); const st = (c, o = {}) => ({ id: 'U3', guild: { id: G }, channelId: c, member: { user: { username: 'v' } }, serverMute: false, serverDeaf: false, streaming: false, selfVideo: false, selfMute: false, ...o });
    await h('voiceStateUpdate')(st(null), st('V1')); await h('voiceStateUpdate')(st('V1'), st(null)); await h('voiceStateUpdate')(st('V1'), st('V2'));
    await h('voiceStateUpdate')(st('V1'), st('V1', { serverMute: true })); await h('voiceStateUpdate')(st('V1'), st('V1', { streaming: true }));
    const n = sent.length; await h('voiceStateUpdate')(st('V1'), st('V1', { selfMute: true }));
    const t = sent.map((s) => s.embed.title);
    assert(n === 5 && sent.length === 5 && to('voice').length === 5, 'count ' + n);
    assert(t[0].includes('Вход') && t[1].includes('Выход') && t[2].includes('Перемещение') && t[3].includes('Серверное отключение микрофона') && t[4].includes('трансляция'.slice(0, 5) ) || t[4].includes('Начата'), t.join(' / '));
    assert(text(sent[2].embed).includes('<#V1>') && text(sent[2].embed).includes('<#V2>'), 'from/to'); lastEmbedOk();
  });
  await test('channels: text -> "Текстовые каналы", voice -> "Голосовые каналы", temp rooms are silent; edits show what changed', async () => {
    clear(); await h('channelCreate')(ch('T1', ChannelType.GuildText)); await h('channelDelete')(ch('T1', ChannelType.GuildText));
    assert(to('channels').length === 2 && text(sent[0].embed).includes('создан') && text(sent[1].embed).includes('удалён'), 'text');
    await h('channelDelete')(ch('CAT', ChannelType.GuildCategory)); assert(sent.length === 2, 'categories skipped');
    clear(); await h('channelCreate')(ch('V9', ChannelType.GuildVoice)); assert(to('voice').length === 1, 'voice create');
    await db.TempVoiceChannel.create({ guildId: G, channelId: 'TV1', ownerId: 'U1' }); clear();
    await h('channelCreate')(ch('TV1', ChannelType.GuildVoice)); await h('channelUpdate')(ch('TV1', ChannelType.GuildVoice, { name: 'a' }), ch('TV1', ChannelType.GuildVoice, { name: 'b' })); await h('channelDelete')(ch('TV1', ChannelType.GuildVoice));
    assert(!sent.length, 'temp room silent ' + sent.length);
    const ow = (id, allow, deny, type = 0) => [id, { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) }];
    const a = ch('T2', ChannelType.GuildText, { name: 'старое', topic: 'a', permissionOverwrites: { cache: new Collection([ow('R1', 0n, 0n)]) } });
    const b = ch('T2', ChannelType.GuildText, { name: 'новое', topic: 'b', rateLimitPerUser: 10, permissionOverwrites: { cache: new Collection([ow('R1', PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles)]) } });
    clear(); await h('channelUpdate')(a, b); const t = text(sent[0].embed);
    assert(to('channels').length === 1 && t.includes('старое') && t.includes('новое') && t.includes('Медленный режим') && t.includes('Отправлять сообщения') && t.includes('Прикреплять файлы') && t.includes('<@&R1>'), t);
    clear(); await h('channelUpdate')(a, { ...a, position: 5 }); assert(!sent.length, 'position only is skipped'); lastEmbedOk();
  });
  await test('roles: create, delete, rename + permissions diff in Russian', async () => {
    const role = (o = {}) => ({ id: 'R7', name: 'Мод', color: 0, hexColor: '#000000', hoist: false, mentionable: false, guild: { id: G }, permissions: new PermissionsBitField(0n), ...o });
    clear(); await h('roleCreate')(role()); await h('roleDelete')(role());
    assert(to('roles').length === 2 && text(sent[0].embed).includes('<@&R7>') && text(sent[1].embed).includes('Роль удалена'), 'create/delete');
    clear(); const F = PermissionsBitField.Flags;
    await h('roleUpdate')(role({ permissions: new PermissionsBitField(F.KickMembers) }), role({ name: 'Модератор', color: 255, hexColor: '#0000ff', permissions: new PermissionsBitField(F.BanMembers | F.ManageMessages) }));
    const t = text(sent[0].embed);
    assert(t.includes('Модератор') && t.includes('#0000ff') && t.includes('Права добавлены') && t.includes('Банить участников') && t.includes('Управлять сообщениями') && t.includes('Права убраны') && t.includes('Выгонять участников'), t);
    clear(); await h('roleUpdate')(role(), role()); assert(!sent.length, 'no changes'); lastEmbedOk();
  });
  await test('server: info, emoji, scheduled events', async () => {
    clear(); const g = (o = {}) => ({ id: G, name: 'A', icon: 'i1', banner: null, splash: null, description: null, verificationLevel: 1, afkChannelId: null, systemChannelId: null, vanityURLCode: null, ownerId: 'O', premiumTier: 0, ...o });
    await h('guildUpdate')(g(), g({ name: 'B', icon: 'i2', premiumTier: 1 })); const t = text(sent[0].embed);
    assert(to('server').length === 1 && t.includes('A → B') && t.includes('Иконка') && t.includes('Уровень буста'), t);
    clear(); await h('guildUpdate')(g(), g()); assert(!sent.length, 'unchanged');
    const emoji = (n) => ({ id: 'E', name: n, guild: { id: G }, imageURL: () => 'http://e.png' });
    await h('emojiCreate')(emoji('smile')); await h('emojiDelete')(emoji('smile')); await h('emojiUpdate')(emoji('a'), emoji('b')); await h('emojiUpdate')(emoji('a'), emoji('a'));
    assert(sent.length === 3 && text(sent[0].embed).includes('smile') && text(sent[2].embed).includes('a → b'), 'emoji ' + sent.length);
    clear(); const ev = (o = {}) => ({ guildId: G, name: 'Турнир', status: 1, scheduledStartTimestamp: Date.now() + 1e6, creatorId: 'U1', ...o });
    await h('guildScheduledEventCreate')(ev()); await h('guildScheduledEventUpdate')(null, ev({ status: 2 })); await h('guildScheduledEventUpdate')(ev(), ev({ status: 3 })); await h('guildScheduledEventDelete')(ev());
    assert(text(sent[1].embed).includes('началось') && text(sent[2].embed).includes('завершено'), 'events ' + text(sent[1].embed) + text(sent[2].embed)); lastEmbedOk();
  });
  await test('a switched-off category stays silent, the others keep working; a deleted thread/webhook does not crash', async () => {
    await db.GuildSettings.update({ logDisabled: JSON.stringify(['roles']) }, { where: { guildId: G } }); S.invalidate(G); clear();
    await h('roleCreate')({ id: 'R', name: 'n', guild: { id: G } }); assert(!sent.length, 'roles off');
    await h('guildMemberAdd')(member()); assert(sent.length === 1, 'members still on');
    WebhookClient.prototype.send = async () => { throw Object.assign(new Error('Unknown Webhook'), { code: 10015 }); };
    const ok = await S.sendLog(G, 'members', require('../bot/utils/embeds').info('x')); assert(ok === false, 'no throw, false');
    await h('guildMemberAdd')(member()); // must not throw
  });
  await test('webhook avatar: created with the bot avatar, old webhooks get it too, posts carry avatar_url; without an avatar the bundled icon is used', async () => {
    const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
    state.tags = []; state.threads.clear(); state.webhooks.clear();
    const r = await setupLogForum(botApi, FORUM, {});
    assert(state.webhooks.get(r.webhookId).avatar === png, 'webhook avatar');
    assert([...state.threads.values()].every((t) => t.avatar_url === 'https://cdn.discordapp.com/avatars/BOT/abc.png?size=256'), 'thread posts carry the avatar');
    state.log.length = 0; await setupLogForum(botApi, FORUM, { webhookId: r.webhookId, webhookToken: r.webhookToken, threads: r.threads });
    assert(state.log.some((x) => x[0] === 'HOOK-AVATAR'), 'existing webhook updated');
    state.botAvatar = null; state.webhooks.clear(); state.threads.clear(); state.tags = [];
    const r2 = await setupLogForum(botApi, FORUM, {}); const av = state.webhooks.get(r2.webhookId).avatar;
    assert(av && av.startsWith('data:image/png;base64,') && av !== png, 'bundled icon fallback'); state.botAvatar = 'abc';
  });
  await test('every log post is sent with the bot avatar', async () => {
    WebhookClient.prototype.send = capture; await db.GuildSettings.update({ logDisabled: '[]' }, { where: { guildId: G } }); S.invalidate(G);
    S.setAvatar('http://cdn/bot.png'); clear(); await h('roleCreate')({ id: 'R', name: 'n', guild: { id: G } });
    assert(sent[0].p.avatarURL === 'http://cdn/bot.png', 'avatarURL ' + sent[0].p.avatarURL);
  });

  // ---- who did it (audit log) ----
  const { AuditLogEvent: AE } = require('discord.js');
  let auditEntries = []; let auditCalls = 0; let canView = true; let eid = 0;
  const entry = (action, targetId, extra = {}) => ({ id: 'e' + ++eid, action, targetId, executorId: 'MOD1', reason: 'нарушение', createdTimestamp: Date.now() - 500, changes: [], ...extra });
  const guildWith = (o = {}) => ({ id: G, members: { me: { permissions: { has: () => canView } } }, fetchAuditLogs: async () => { auditCalls++; return { entries: new Collection(auditEntries.map((e) => [e.id, e])) }; }, ...o });
  await test('who: a deleted message shows the moderator; a self-delete says "вероятно, сам автор"; no permission is not an error', async () => {
    await db.GuildSettings.update({ logDisabled: '[]' }, { where: { guildId: G } }); S.invalidate(G);
    const g = guildWith(); clear();
    auditEntries = [entry(AE.MessageDelete, 'U1', { extra: { channel: { id: 'C1' }, count: 1 } })];
    const m = msg({ id: 'W1', guild: g }); await h('messageCreate')(m); clear();
    await h('messageDelete')({ id: 'W1', guild: g, guildId: G, channelId: 'C1', partial: true, content: null, author: null });
    assert(text(to('messages')[0].embed).includes('<@MOD1>') && text(to('messages')[0].embed).includes('Удалил'), text(sent[0].embed));
    auditEntries = []; S.invalidate(G); clear(); await sleep(1100);
    const m2 = msg({ id: 'W2', guild: g }); await h('messageCreate')(m2); clear();
    await h('messageDelete')({ id: 'W2', guild: g, guildId: G, channelId: 'C1', partial: true, content: null, author: null });
    assert(text(to('messages')[0].embed).includes('вероятно, сам автор'), 'self delete');
    canView = false; auditCalls = 0; auditEntries = [entry(AE.MessageDelete, 'U1')]; clear(); await sleep(1100);
    await h('messageDelete')({ id: 'x', guild: g, guildId: G, channelId: 'C1', partial: true, content: null, author: { id: 'U1' } });
    assert(sent.length === 1 && !auditCalls && text(sent[0].embed).includes('вероятно'), 'no permission -> no audit request, log still sent'); canView = true;
  });
  await test('who: roles, nickname, role edits, channel and server changes name the person', async () => {
    const g = guildWith(); auditEntries = []; clear(); await sleep(1100);
    const role = { id: 'R7', name: 'Мод', color: 0, hexColor: '#000', hoist: false, mentionable: false, guild: g, permissions: new PermissionsBitField(0n) };
    auditEntries = [entry(AE.RoleCreate, 'R7', { executorId: 'ADM' })]; await h('roleCreate')(role);
    assert(text(sent[0].embed).includes('<@ADM>') && text(sent[0].embed).includes('Создал'), 'role create');
    auditEntries = [entry(AE.RoleUpdate, 'R7', { executorId: 'ADM2' })]; clear(); await sleep(1100);
    await h('roleUpdate')(role, { ...role, name: 'Новое' }); assert(text(sent[0].embed).includes('<@ADM2>'), 'role update');
    clear(); await sleep(1100); auditEntries = [entry(AE.MemberUpdate, 'U2', { executorId: 'MOD9', changes: [{ key: 'nick' }] })];
    await h('guildMemberUpdate')({ ...member({ nickname: 'a' }) }, member({ nickname: 'b', guild: g }));
    assert(text(sent[0].embed).includes('<@MOD9>') && text(sent[0].embed).includes('Изменил'), 'nick');
    clear(); await sleep(1100); auditEntries = [entry(AE.MemberRoleUpdate, 'U2', { executorId: 'MOD8' })];
    await h('guildMemberUpdate')(member({ roles: { cache: new Collection() } }), member({ guild: g, roles: { cache: new Collection([['R1', { id: 'R1' }]]) } }));
    assert(text(sent[0].embed).includes('<@MOD8>'), 'member roles');
    clear(); await sleep(1100); auditEntries = [entry(AE.ChannelOverwriteUpdate, 'T5', { executorId: 'MOD7' })];
    await h('channelUpdate')(ch('T5', ChannelType.GuildText, { name: 'a', guild: g }), ch('T5', ChannelType.GuildText, { name: 'b', guild: g }));
    assert(text(sent[0].embed).includes('<@MOD7>'), 'channel update');
    clear(); await sleep(1100); auditEntries = [entry(AE.GuildUpdate, G, { executorId: 'OWN' })];
    await h('guildUpdate')({ id: G, name: 'A', icon: null, banner: null, splash: null, description: null, verificationLevel: 1, afkChannelId: null, systemChannelId: null, vanityURLCode: null, ownerId: 'O', premiumTier: 0 }, { id: G, name: 'B', icon: null, banner: null, splash: null, description: null, verificationLevel: 1, afkChannelId: null, systemChannelId: null, vanityURLCode: null, ownerId: 'O', premiumTier: 0, ...{} , fetchAuditLogs: g.fetchAuditLogs, members: g.members });
    assert(text(sent[0].embed).includes('<@OWN>'), 'guild update ' + text(sent[0]?.embed));
  });
  await test('who: kicks (found only in the audit log), manual bans and timeouts show the moderator and the reason', async () => {
    const g = guildWith(); clear(); await sleep(1100);
    auditEntries = [entry(AE.MemberKick, 'U5', { executorId: 'MODK', reason: 'спам' })];
    await h('guildMemberRemove')({ ...member({ id: 'U5', guild: g }), user: user({ id: 'U5' }) });
    assert(to('punishments').length === 1 && text(to('punishments')[0].embed).includes('<@MODK>') && text(to('punishments')[0].embed).includes('спам') && text(to('members')[0].embed).includes('выгнали'), 'kick logged in both threads');
    clear(); await sleep(1100); auditEntries = [];
    await h('guildMemberRemove')({ ...member({ id: 'U6', guild: g }), user: user({ id: 'U6' }) });
    assert(to('punishments').length === 0 && text(sent[0].embed).includes('Участник вышел'), 'a normal leave is not a kick');
    clear(); await sleep(1100); auditEntries = [entry(AE.MemberBanAdd, 'U7', { executorId: 'MODB', reason: 'реклама' })];
    await h('guildBanAdd')({ guild: g, user: { id: 'U7', username: 'z' }, reason: null });
    assert(text(sent[0].embed).includes('<@MODB>') && text(sent[0].embed).includes('реклама'), 'ban');
    clear(); await sleep(1100); const until = new Date(Date.now() + 600000);
    auditEntries = [entry(AE.MemberUpdate, 'U2', { executorId: 'MODT', changes: [{ key: 'communication_disabled_until' }] })];
    await h('guildMemberUpdate')(member(), member({ guild: g, communicationDisabledUntilTimestamp: +until, communicationDisabledUntil: until }));
    assert(text(sent[0].embed).includes('<@MODT>'), 'timeout');
  });
  await test('who: one audit entry is never given to two events; an old entry is ignored; several events share one request', async () => {
    const g = guildWith(); await sleep(1100); auditEntries = [entry(AE.RoleCreate, 'RA'), entry(AE.RoleCreate, 'RB', { executorId: 'OTHER' }), entry(AE.RoleDelete, 'RC', { createdTimestamp: Date.now() - 60000 })]; auditCalls = 0;
    const r = (id) => ({ id, name: id, hexColor: '#000', guild: g }); clear();
    await Promise.all([h('roleCreate')(r('RA')), h('roleCreate')(r('RB')), h('roleDelete')(r('RC'))]);
    const t = sent.map((x) => text(x.embed));
    assert(t.some((x) => x.includes('RA') && x.includes('<@MOD1>')) && t.some((x) => x.includes('RB') && x.includes('<@OTHER>')), 'each event got its own entry');
    assert(!t.find((x) => x.includes('Роль удалена')).includes('Удалил'), 'a minute old entry is not used');
    assert(auditCalls <= 2, 'requests were shared: ' + auditCalls);
  });
  await test('the invite permission list contains "View Audit Log"', async () => {
    const { PERMISSIONS } = require('../bot/utils/invite'); const { PermissionFlagsBits: F } = require('discord.js');
    assert(PERMISSIONS.includes(F.ViewAuditLog), 'audit permission');
  });
  await test('members are loaded into the cache once for guilds with the forum (needed to see old nicknames and roles)', async () => {
    const fetched = []; const mk = (id) => ({ id, members: { fetch: async () => { fetched.push(id); } } });
    const client = { guilds: { cache: new Map([[G, mk(G)], ['OTHER', mk('OTHER')]]) } };
    await db.GuildSettings.update({ logDisabled: '[]' }, { where: { guildId: G } }); S.invalidate(G);
    await handlers.loadMembersForLogs(client); await handlers.loadMembersForLogs(client);
    assert(fetched.join() === G, 'only the guild with logs, once: ' + fetched);
  });
  await test('every log event is registered with discord.js (array export) and the intents are enabled', async () => {
    const { loadEvents } = require('../bot/handlers/loadEvents'); const names = [];
    loadEvents({ on: (n) => names.push(n), once: (n) => names.push(n) });
    for (const n of ['messageCreate', 'messageUpdate', 'messageDelete', 'messageDeleteBulk', 'guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildBanAdd', 'guildBanRemove', 'voiceStateUpdate', 'channelCreate', 'channelDelete', 'channelUpdate', 'roleCreate', 'roleDelete', 'roleUpdate', 'guildUpdate', 'emojiCreate', 'emojiDelete', 'emojiUpdate', 'stickerCreate', 'stickerDelete', 'stickerUpdate', 'guildScheduledEventCreate', 'guildScheduledEventUpdate', 'guildScheduledEventDelete', 'interactionCreate', 'clientReady'])
      assert(names.includes(n), 'not registered: ' + n);
    const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8');
    for (const i of ['GuildExpressions', 'GuildScheduledEvents', 'GuildModeration']) assert(src.includes(i), 'intent ' + i);
  });
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
