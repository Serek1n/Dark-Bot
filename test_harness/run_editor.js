// Message editor (embeds for welcome, farewell, level-up and custom commands), per-rule automod with name checks,
// several "join to create" voice channels.
process.env.DATABASE_PATH = './data/test_editor.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', CH = '800000000000000001', V1 = '800000000000000011', V2 = '800000000000000012', CAT = '800000000000000020', R1 = '600000000000000001';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map(), getUsers: async () => ({}),
  getGuildChannels: async () => [{ id: CH, name: 'общий', type: 0 }, { id: V1, name: 'Создать', type: 2 }, { id: V2, name: 'Дуо', type: 2 }, { id: CAT, name: 'Игры', type: 4 }],
  getGuildRoles: async () => [{ id: R1, name: 'Медиа', position: 1 }],
  getGuild: async (id) => ({ id, name: 'T', icon: null }),
  botApi: { get: require('./ownerGuild').ownerGet(G, [R1]), post: async () => ({ data: {} }), delete: async () => ({}), put: async () => ({}) }
});
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  const db = require('../db'); await db.init();
  const mb = require('../bot/utils/messageBuilder');
  const { makeGuild, makeChannel, makeMember, makeVoiceState } = require('./mock_events');

  await test('embed data is cleaned: bad colour, thumbnail and switched-off embeds are dropped', async () => {
    assert.strictEqual(mb.parseEmbed(null), null); assert.strictEqual(mb.parseEmbed('{bad'), null); assert.strictEqual(mb.parseEmbed({ on: false, title: 'x' }), null);
    const e = mb.parseEmbed({ on: true, title: 'x'.repeat(300), color: 'red', thumbnail: 'evil', description: 'd' });
    assert(e.title.length === 256 && e.color === '' && e.thumbnail === '');
    assert.strictEqual(mb.parseEmbed({ on: true, color: '#AABBCC' }).color, '#aabbcc');
  });

  await test('a message is built with templates in every part; empty parts stay empty; only http(s) pictures', async () => {
    const fill = (t) => t.replace('{name}', 'Вася');
    const m = mb.buildMessage({ text: 'Привет, {name}', embed: { on: true, title: 'Добро пожаловать, {name}', description: '', footer: 'Сервер', color: '#ff0000', thumbnail: 'avatar', image: 'javascript:alert(1)', timestamp: true }, fill, images: { avatar: 'https://cdn/a.png' } });
    const j = m.embeds[0].toJSON();
    assert(m.content === 'Привет, Вася' && j.title === 'Добро пожаловать, Вася' && !j.description && j.footer.text === 'Сервер' && j.color === 0xff0000 && j.thumbnail.url === 'https://cdn/a.png' && !j.image && j.timestamp, JSON.stringify(j));
    assert.deepStrictEqual(mb.buildMessage({ text: 'x', embed: { on: true, title: '', description: '  ' } }).embeds, [], 'an empty embed is not sent');
    let called = 0; mb.buildMessage({ text: '', embed: { on: true, title: 'a' }, fill: (t) => { called++; return t; } });
    assert.strictEqual(called, 1, 'empty parts are not passed to the template engine (no default texts)');
    assert.strictEqual(mb.buildMessage({ text: 'a', embed: { on: true, title: 't' }, attachmentImage: 'attachment://welcome.png' }).embeds[0].toJSON().image.url, 'attachment://welcome.png');
  });

  await test('welcome and farewell: the embed goes out with the member\'s data, the text may be empty', async () => {
    await db.GuildSettings.create({ guildId: 'gw', welcomeEnabled: true, welcomeChannelId: 'wc', leaveChannelId: 'lc', welcomeMessage: '', welcomeEmbed: JSON.stringify({ on: true, title: 'Привет, {name}!', description: 'Ты {count}-й', thumbnail: 'avatar' }), leaveMessage: '{user} ушёл', leaveEmbed: JSON.stringify({ on: true, description: 'Пока, { member.display_name }' }) });
    const wc = makeChannel('wc'), lc = makeChannel('lc');
    const guild = makeGuild({ id: 'gw', memberCount: 42, channelsById: new Map([['wc', wc], ['lc', lc]]), iconURL: () => null });
    const member = makeMember('U1', guild, { displayName: 'Аня', user: { id: 'U1', username: 'anya', bot: false, displayAvatarURL: () => 'https://cdn/u1.png' } });
    await require('../bot/events/guildMemberAdd').execute(member);
    const w = wc._sent[0]; const we = w.embeds[0].toJSON();
    assert(w.content === '' && we.title === 'Привет, Аня!' && we.description === 'Ты 42-й' && we.thumbnail.url === 'https://cdn/u1.png', JSON.stringify(w));
    assert.deepStrictEqual(w.allowedMentions, { users: ['U1'] });
    await require('../bot/events/guildMemberRemove').execute(member);
    const l = lc._sent[0];
    assert(l.content === 'Аня ушёл' && l.embeds[0].toJSON().description === 'Пока, Аня' && l.allowedMentions.parse.length === 0, JSON.stringify(l));
  });

  await test('level-up: the server\'s own embed replaces the standard frame, with {level} and {name} in it', async () => {
    const sent = []; const channel = { send: async (p) => sent.push(p) };
    const guild = { id: 'gl', name: 'S', iconURL: () => null, roles: { cache: new Map() } };
    const user = { id: 'U2', username: 'bob', displayAvatarURL: () => 'https://cdn/b.png' };
    const settings = { levelUpMessage: '', levelUpEmbedData: JSON.stringify({ on: true, title: '{name} — уровень {level}!', color: '#00ff00', thumbnail: 'avatar' }) };
    await require('../bot/utils/levelUp').announceLevelUp({ guild, user, displayName: 'Боб', level: 7, oldLevel: 6, channel, settings });
    const e = sent[0].embeds[0].toJSON();
    assert(e.title === 'Боб — уровень 7!' && e.color === 0x00ff00 && sent[0].content === '', JSON.stringify(sent[0]));
  });

  await test('custom command: an answer that is only an embed, with templates', async () => {
    const { getOrCreateSettings } = require('../bot/modules/leveling');
    const s = await getOrCreateSettings('gc'); s.customCommandsEnabled = true; s.prefix = '!'; s.levelingEnabled = false; await s.save();
    await db.CustomCommand.create({ guildId: 'gc', trigger: 'инфо', response: '', embed: JSON.stringify({ on: true, title: 'Сервер { guild.name }', description: 'Спросил { member.display_name }' }), createdBy: 'X' });
    const sent = [];
    const guild = { id: 'gc', name: 'Клуб', iconURL: () => null, memberCount: 3 };
    await require('../bot/events/messageCreate').execute({ guild, author: { id: 'U3', bot: false, username: 'kim', displayAvatarURL: () => null }, member: { id: 'U3', displayName: 'Ким', guild, user: { id: 'U3', username: 'kim' } }, channelId: 'cc', channel: { send: async (p) => sent.push(p) }, content: '!инфо' });
    const e = sent[0]?.embeds?.[0]?.toJSON();
    assert(e && e.title === 'Сервер Клуб' && e.description === 'Спросил Ким' && sent[0].allowedMentions.parse[0] === 'users', JSON.stringify(sent));
  });

  // ---------- automod ----------
  const automod = require('../bot/modules/automod');
  const base = { automodEnabled: true, automodBannedWords: '["плохо"]', automodBlockLinks: true, automodLinkWhitelist: '[]', automodAction: 'delete', automodMuteMinutes: 10 };
  const msg = (content, extra = {}) => ({ content, guildId: 'ga', channelId: 'C1', author: { id: 'A' }, member: { permissions: { has: () => false }, roles: { cache: new Map() } }, ...extra });

  await test('automod: each rule has its own exceptions and punishment, the rest follow the common ones', async () => {
    const rules = JSON.stringify({ links: { ch: ['MEDIA'] }, words: { action: 'mute', mute: 60, roles: ['VIP'] } });
    const s = { ...base, automodRules: rules };
    assert.deepStrictEqual(await automod.evaluate(s, msg('плохо')), { key: 'words', reason: 'запрещённое слово' });
    assert.strictEqual(await automod.evaluate(s, msg('https://x.ru', { channelId: 'MEDIA' })), null, 'links allowed in #media');
    assert.strictEqual((await automod.evaluate(s, msg('плохо', { channelId: 'MEDIA' }))).key, 'words', 'other rules still work there');
    assert.strictEqual(await automod.evaluate(s, msg('плохо', { member: { permissions: { has: () => false }, roles: { cache: new Map([['VIP', {}]]) } } })), null, 'VIP may say it');
    assert.deepStrictEqual(automod.punishmentFor(s, 'words'), { action: 'mute', minutes: 60 });
    assert.deepStrictEqual(automod.punishmentFor({ ...s, automodAction: 'warn' }, 'links'), { action: 'warn', minutes: 10 }, 'common punishment');
    assert.deepStrictEqual(automod.punishmentFor({ ...s, automodRules: '{broken' }, 'words'), { action: 'delete', minutes: 10 }, 'broken JSON = common');
    assert.strictEqual(await automod.evaluateMessage(s, msg('плохо')), 'запрещённое слово', 'the old function still gives the text');
  });

  await test('automod: a rule\'s own punishment is applied (mute for words, while the common one is delete)', async () => {
    const mod = require('../bot/modules/moderation'); const real = mod.muteMember; const muted = [];
    mod.muteMember = async (g, m, ms) => { muted.push(ms); };
    try {
      const s = { ...base, automodRules: JSON.stringify({ words: { action: 'mute', mute: 30 } }) };
      const m = { ...msg('плохо'), author: { id: 'B' + Date.now() }, guild: { id: 'ga', members: { fetch: async () => ({}) } }, client: { user: { id: 'BOT' } }, delete: async () => {}, channel: { send: async () => ({ delete: async () => {} }) } };
      m.member = { id: m.author.id };
      await automod.handleViolation(s, m, 'запрещённое слово', 'words');
      assert.deepStrictEqual(muted, [30 * 60000]);
    } finally { mod.muteMember = real; }
  });

  await test('names: banned words, invites and zalgo are replaced; "!!!" in front is cut; moderators and ignored roles are left alone', async () => {
    const s = { ...base, automodNicknames: true, automodDehoist: true, automodNickReplacement: 'Участник', automodIgnoredRoles: '["VIP"]' };
    const mem = (name, extra = {}) => ({ displayName: name, user: { bot: false }, permissions: { has: () => false }, roles: { cache: new Map() }, ...extra });
    assert.strictEqual(automod.nameVerdict(s, mem('плохой парень')).nick, 'Участник');
    assert.strictEqual(automod.nameVerdict(s, mem('discord.gg/abc')).nick, 'Участник');
    assert.strictEqual(automod.nameVerdict(s, mem('!!!Вася')).nick, 'Вася');
    assert.strictEqual(automod.nameVerdict(s, mem('!!!')).nick, 'Участник', 'nothing left → the replacement');
    assert.strictEqual(automod.nameVerdict(s, mem('Вася')), null);
    assert.strictEqual(automod.nameVerdict(s, mem('Участник')), null, 'the replacement itself is fine (no loop)');
    assert.strictEqual(automod.nameVerdict(s, mem('плохо', { permissions: { has: () => true } })), null, 'moderators');
    assert.strictEqual(automod.nameVerdict(s, mem('плохо', { roles: { cache: new Map([['VIP', {}]]) } })), null, 'ignored role');
    assert.strictEqual(automod.nameVerdict({ ...s, automodEnabled: false }, mem('плохо')), null, 'automod off');
    assert.strictEqual(automod.nameVerdict({ ...s, automodNicknames: false }, mem('плохо')), null, 'only dehoist on');
  });

  await test('names: the nickname is changed on join and on a name change, not on role changes', async () => {
    await db.GuildSettings.create({ guildId: 'gn', automodEnabled: true, automodNicknames: true, automodBannedWords: '["плохо"]', welcomeEnabled: false });
    const set = [];
    const member = (name) => ({ id: 'N1', guild: { id: 'gn', members: { fetch: async () => null } }, displayName: name, nickname: name, manageable: true, user: { id: 'N1', bot: false }, permissions: { has: () => false }, roles: { cache: new Map() }, client: { user: { id: 'BOT' } }, setNickname: async (n) => set.push(n) });
    await require('../bot/events/guildMemberAdd').execute(member('плохой'));
    const ev = require('../bot/events/nameCheck');
    await ev.execute(member('плохой'), member('плохой')); // a role change: the same name
    await ev.execute(member('Вася'), member('плохо2'));
    assert.deepStrictEqual(set, ['Ник скрыт', 'Ник скрыт'], JSON.stringify(set));
    const notManageable = { ...member('плохо'), manageable: false };
    await ev.execute(member('a'), notManageable); assert.strictEqual(set.length, 2, 'above the bot: left alone');
  });

  // ---------- voice ----------
  await test('voice: an extra "join to create" channel has its own category, name and limit; empty ones fall back to the main', async () => {
    const vt = require('../bot/utils/voiceTriggers');
    const s = { tempVoiceJoinChannelId: V1, tempVoiceNameTemplate: 'Комната {user}', tempVoiceUserLimit: 0, tempVoiceTriggers: JSON.stringify([{ channelId: V2, categoryId: CAT, name: '', limit: 2 }, { channelId: 'bad' }]) };
    assert.deepStrictEqual(vt.triggerFor(s, V2), { channelId: V2, categoryId: CAT, name: 'Комната {user}', limit: 2 });
    assert.strictEqual(vt.triggerFor(s, V1).limit, 0); assert.strictEqual(vt.triggerFor(s, 'other'), null);
    assert.strictEqual(vt.extraTriggers(s).length, 1, 'a bad row is dropped');
    assert(vt.hasTriggers({ tempVoiceTriggers: s.tempVoiceTriggers }) && !vt.hasTriggers({}));

    await db.GuildSettings.create({ guildId: 'gv', tempVoiceEnabled: true, tempVoiceTriggers: JSON.stringify([{ channelId: V2, categoryId: CAT, name: 'Дуо {user}', limit: 2 }]) });
    const guild = makeGuild({ id: 'gv' }); const made = [];
    const create = guild.channels.create; guild.channels.create = async (o) => { made.push(o); return create(o); };
    const trig = makeChannel(V2, { parentId: 'OTHER' }); guild._channelsById.set(V2, trig);
    const member = makeMember('m2', guild, { displayName: 'Лена', user: { id: 'm2', bot: false } });
    let moved = null;
    await require('../bot/events/voiceStateUpdate').execute(makeVoiceState({ guild, channelId: null }), makeVoiceState({ guild, channelId: V2, channel: trig, member, setChannel: async (c) => { moved = c; } }));
    assert(made[0] && made[0].name === 'Дуо Лена' && made[0].parent === CAT && made[0].userLimit === 2 && moved, made[0] ? [made[0].name, made[0].parent, made[0].userLimit, Boolean(moved)].join(' | ') : 'nothing made');
  });

  // ---------- panel ----------
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.locals.tplRef = require('../bot/utils/replacers').REFERENCE;
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base2 = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base2 + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' }).then((r) => r.headers.get('location') || String(r.status));
  await db.GuildSettings.findOrCreate({ where: { guildId: G } });
  const S = () => db.GuildSettings.findByPk(G);

  await test('panel: welcome and farewell embeds are saved; text may be empty with an embed; switching off clears it', async () => {
    assert((await post('/welcome', { welcomeMessage: '', welcomeEmbed_on: 'on', welcomeEmbed_title: 'Привет, {name}', welcomeEmbed_color: '#123456', welcomeEmbed_image: 'javascript:x', welcomeEmbed_thumbnail: 'avatar', leaveMessage: 'пока' })).includes('saved'));
    let s = await S(); const e = JSON.parse(s.welcomeEmbed);
    assert(s.welcomeMessage === '' && e.title === 'Привет, {name}' && e.color === '#123456' && e.image === '' && e.thumbnail === 'avatar' && s.leaveEmbed === null, s.welcomeEmbed);
    await post('/welcome', { welcomeMessage: '', leaveMessage: 'пока' }); s = await S();
    assert(s.welcomeEmbed === null && s.welcomeMessage === '', 'no embed and no text: the old text stays (empty here)');
    const page = await (await fetch(base2 + '/welcome')).text();
    assert((page.match(/data-embed-editor=/g) || []).length === 2 && page.includes('name="leaveEmbed_title"'), 'two editors on the page');
  });

  await test('panel: a custom command may be only an embed; nothing at all is refused; level-up embed is saved', async () => {
    assert((await post('/custom-commands', { trigger: 'карта', response: '', ccEmbed_on: 'on', ccEmbed_title: 'Карта', ccEmbed_image: 'https://x/map.png' })).includes('saved'));
    const c = await db.CustomCommand.findOne({ where: { guildId: G, trigger: 'карта' } }); assert(c.response === '' && JSON.parse(c.embed).image === 'https://x/map.png');
    assert((await post('/custom-commands', { trigger: 'пусто', response: '', ccEmbed_on: 'on', ccEmbed_title: '' })).includes('invalid'));
    const list = await (await fetch(base2 + '/custom-commands')).text(); assert(list.includes('эмбед') && list.includes('data-embed-editor="ccEmbed"'));
    await post('/leveling', { levelUpEmbedData_on: 'on', levelUpEmbedData_title: '{name} — {level}' });
    assert.strictEqual(JSON.parse((await S()).levelUpEmbedData).title, '{name} — {level}');
  });

  await test('panel: per-rule automod settings and name options are saved; empty rules are not stored', async () => {
    assert((await post('/automod', { automodEnabled: 'on', rule_links_ch: CH, rule_words_action: 'mute', rule_words_mute: '45', rule_caps_action: 'evil', automodNicknames: 'on', automodDehoist: 'on', automodNickReplacement: '  ' })).includes('saved'));
    const s = await S(); const r = JSON.parse(s.automodRules);
    assert.deepStrictEqual(r, { words: { action: 'mute', mute: 45 }, links: { ch: [CH] } }, s.automodRules);
    assert(s.automodNicknames && s.automodDehoist && s.automodNickReplacement === 'Ник скрыт');
    const page = await (await fetch(base2 + '/automod')).text();
    assert(page.includes('Особое наказание для отдельных правил') && page.includes('удалить и замутить на 45 мин') && page.includes('не действует в 1 кан.') && page.includes('name="automodDehoist" checked'), 'shown back');
    assert(/<details class="rule-cfg" data-rule="caps" hidden>/.test(page) && /<details class="rule-cfg" data-rule="words" >/.test(page), 'only rules with a special punishment are listed');
  });

  await test('panel: more trigger channels are saved (no duplicates, the main one is not repeated, a removed row disappears)', async () => {
    const body = new URLSearchParams({ tempVoiceJoinChannelId: V1, tempVoiceNameTemplate: 'Комната {user}', tempVoiceUserLimit: '150' });
    [[V2, CAT, 'Дуо', '2'], [V2, '', 'x', '3'], [V1, '', '', '0'], ['', '', '', '']].forEach(([c, k, n, l]) => { body.append('trig_channel', c); body.append('trig_category', k); body.append('trig_name', n); body.append('trig_limit', l); });
    const loc = await fetch(base2 + '/temp-voice', { method: 'POST', body, redirect: 'manual' }).then((r) => r.headers.get('location'));
    assert(loc.includes('saved'));
    const s = await S();
    assert.deepStrictEqual(JSON.parse(s.tempVoiceTriggers), [{ channelId: V2, categoryId: CAT, name: 'Дуо', limit: 2 }]);
    assert.strictEqual(s.tempVoiceUserLimit, 99, 'limit clamped');
    const page = await (await fetch(base2 + '/temp-voice')).text();
    assert((page.match(/class="trig-row"/g) || []).length === 2 && page.includes('value="Дуо"'), 'the saved row and one empty');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
