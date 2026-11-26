// Stage 3 of the panel: polls (roles, limits, one answer, anonymous button votes, ending from the panel), mini-games
// (games on/off, pause, private answers, own ball answers, bets with tax and a daily cap), reminders (limits, a clock
// time in the server's zone, DMs only, no role pings), the bot's look (colours, marks, footer, dates, private info
// answers), «where and for whom» (channels, roles, pause) enforced before a command, the settings file (export,
// import with IDs matched by name, a module reset) and the panel pages of these modules.
process.env.DATABASE_PATH = './data/test_stage3.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 's'.repeat(40);
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { MessageFlags } = require('discord.js');
const G = '777000000000000001', CH = '800000000000000001', CH2 = '800000000000000002', ROLE = '600000000000000001', ROLE2 = '600000000000000002';
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
const json = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? String(v) : v && v.toJSON && typeof v.toJSON === 'function' && v.data ? v.toJSON() : v));

(async () => {
  const db = require('../db'); await db.init();
  const mc = require('../bot/utils/moduleConfig');
  const { getOrCreateSettings } = require('../bot/modules/leveling');
  const set = async (key, v, extra = {}) => { const s = await getOrCreateSettings(G); mc.write(s, key, v); Object.assign(s, extra); await s.save(); return s; };
  const inter = (o = {}) => {
    const out = { replies: [], edits: [] };
    const opts = o.options || {};
    const i = { guildId: G, guild: { id: G }, channelId: CH, user: { id: o.user || 'U1', username: 'Vasya' }, member: o.member || { displayName: 'Вася', permissions: { has: () => false }, roles: { cache: new Map((o.roles || []).map((r) => [r, {}])) } },
      channel: { permissionsFor: () => ({ has: () => true }) },
      options: { getSubcommand: () => o.sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null },
      reply: async (p) => { out.replies.push(p); }, editReply: async (p) => { out.edits.push(p); }, fetchReply: async () => o.message || { id: 'M' + Math.random().toString(36).slice(2), channelId: CH, react: async () => {} } };
    return { i, out };
  };

  // ---- polls ----
  const poll = require('../bot/commands/utility/poll');
  const polls = require('../bot/modules/polls');
  await test('polls: only the chosen roles create them (the right to manage the server always); options and the longest time are limited', async () => {
    await set('polls', { creatorRoles: [ROLE], maxOptions: 3, maxDays: 2 });
    let { i, out } = inter({ options: { question: 'Q' } });
    await poll.execute(i); assert(json(out.replies[0]).includes('особыми ролями'), json(out.replies[0]));
    ({ i, out } = inter({ roles: [ROLE], options: { question: 'Q', options: 'a | b | c | d' } }));
    await poll.execute(i); assert(json(out.replies[0]).includes('от 2 до 3'), json(out.replies[0]));
    ({ i, out } = inter({ roles: [ROLE], options: { question: 'Q', options: 'a | b', duration: '3d' } }));
    await poll.execute(i); assert(json(out.replies[0]).includes('до 2 дн'), json(out.replies[0]));
  });
  await test('polls: an anonymous poll needs a time and votes by buttons; one answer replaces the other, a second press takes it back', async () => {
    await set('polls', { creatorRoles: [], anonymous: true, multi: false });
    let { i, out } = inter({ options: { question: 'Аноним?', options: 'Да | Нет', anonymous: true } });
    await poll.execute(i); assert(json(out.replies[0]).includes('должен быть срок'), 'needs a time');
    ({ i, out } = inter({ options: { question: 'Аноним?', options: 'Да | Нет', anonymous: true, duration: '1h' }, message: { id: 'MANON', channelId: CH, react: async () => { throw new Error('no reactions on an anonymous poll'); } } }));
    await poll.execute(i);
    const p = await db.Poll.findOne({ where: { messageId: 'MANON' } });
    assert(p.anonymous && p.multi === false && out.edits[0].components.length === 1, 'saved with buttons');
    const press = async (user, idx) => { const r = []; await polls.handlePollButton({ customId: `${polls.VOTE}${p.id}:${idx}`, user: { id: user }, reply: async (x) => r.push(x) }); return r[0]; };
    await press('A', 0); await press('A', 1); await press('B', 1); await press('C', 0); await press('C', 0);
    await p.reload(); assert.deepStrictEqual(polls.parseVotes(p), { A: [1], B: [1] });
    const sent = []; const msg = { edit: async () => {}, reply: async (x) => sent.push(x) };
    const counts = await polls.finish({ channels: { fetch: async () => ({ messages: { fetch: async () => msg }, send: async () => {} }) } }, p);
    assert.deepStrictEqual(counts, [0, 2]); assert(json(sent[0]).includes('Всего голосов: **2**'), json(sent[0]));
  });
  await test('polls: the result in the server\'s look (bars, colour, footer); ending early from the panel', async () => {
    const e = polls.resultEmbed({ question: 'Q', options: JSON.stringify([{ emoji: '1️⃣', label: 'a' }, { emoji: '2️⃣', label: 'b' }]) }, [3, 1], { ...mc.defaults('polls'), barFull: '#', barEmpty: '.', resultColor: '#112233', footer: 'Сервер' }).toJSON();
    assert(e.description.includes('`########..`') && e.color === 0x112233 && e.footer.text === 'Сервер', JSON.stringify(e));
    const p = await db.Poll.create({ guildId: G, channelId: CH, messageId: 'MEND', question: 'Q', options: '[]', endsAt: new Date(Date.now() + 3600_000) });
    assert(await polls.endNow(G, p.id)); await p.reload(); assert(new Date(p.endsAt).getTime() <= Date.now());
    assert(!(await polls.endNow('777000000000000999', p.id)), 'not another server\'s poll');
  });

  // ---- mini-games ----
  const fun = require('../bot/commands/fun/fun');
  const bets = require('../bot/modules/funBets');
  await test('mini-games: a game switched off answers privately; the pause; a private result; the server\'s own ball answers', async () => {
    await set('fun', { dice: false, cooldownSec: 60, ephemeral: true, answersGood: ['Ага'], answersMaybe: [], answersBad: [] });
    let { i, out } = inter({ sub: 'dice' }); await fun.execute(i);
    assert(out.replies[0].flags === MessageFlags.Ephemeral && json(out.replies[0]).includes('выключена'));
    ({ i, out } = inter({ sub: '8ball', options: { question: 'Да?' } })); await fun.execute(i);
    assert(out.replies[0].flags === MessageFlags.Ephemeral && json(out.replies[0]).includes('Ага'), json(out.replies[0]));
    ({ i, out } = inter({ sub: '8ball', options: { question: 'Да?' } })); await fun.execute(i);
    assert(json(out.replies[0]).includes('Подождите'), 'pause');
    assert.strictEqual(fun.answersOf(mc.defaults('fun')).length, 20, 'the standard answers when the lists are empty');
  });
  await test('bets: off, economy off, too small, too big are refused; a win pays ×1.9 minus the tax to the treasury; a loss takes the bet; a draw returns it', async () => {
    const cfg = { ...mc.defaults('fun'), bets: true, betMin: 10, betMax: 100, taxPct: 10, coinflipPayout: 190, rpsPayout: 200, dailyWinCap: 150 };
    assert(await bets.refusal(G, 'P1', { ...cfg, bets: false }, 50)); assert(await bets.refusal(G, 'P1', cfg, 50, false));
    assert(/не меньше/.test(await bets.refusal(G, 'P1', cfg, 5))); assert(/не больше/.test(await bets.refusal(G, 'P1', cfg, 500)));
    await db.MemberProfile.create({ guildId: G, userId: 'P1', balance: 1000 });
    const t0 = Number((await db.GuildSettings.findByPk(G)).treasury || 0);
    let r = await bets.settle(G, 'P1', cfg, 100, 'win', 'coinflip');
    assert(r.ok && r.tax === 9 && r.paid === 181 && r.balance === 1081, JSON.stringify(r));
    assert.strictEqual(Number((await db.GuildSettings.findByPk(G)).treasury) - t0, 9, 'tax in the treasury');
    r = await bets.settle(G, 'P1', cfg, 50, 'lose', 'rps'); assert(r.balance === 1031, JSON.stringify(r));
    r = await bets.settle(G, 'P1', cfg, 50, 'draw', 'rps'); assert(r.balance === 1031, 'a draw gives it back');
    assert.strictEqual(await bets.todayProfit(G, 'P1'), 31);
    await bets.settle(G, 'P1', cfg, 100, 'win', 'rps'); await bets.settle(G, 'P1', cfg, 100, 'win', 'rps'); // +90 twice: the day's profit is past 150 now
    assert(/предел/.test(await bets.refusal(G, 'P1', cfg, 10)), 'the daily cap');
    assert(!(await bets.settle(G, 'NOBODY', cfg, 50, 'win', 'coinflip')).ok, 'no money, no bet');
  });

  // ---- reminders ----
  const remind = require('../bot/commands/utility/remind');
  await test('reminders: «18:30» is the next 18:30 in the server\'s zone; a date; the limits of the server; DMs only; no role pings', async () => {
    const now = Date.parse('2026-11-25T12:00:00Z'); // 15:00 in Moscow
    assert.strictEqual(remind.whenOf('18:30', 'Europe/Moscow', now), 3.5 * 3600_000);
    assert.strictEqual(remind.whenOf('14:00', 'Europe/Moscow', now), 23 * 3600_000, 'tomorrow when it has passed');
    assert.strictEqual(remind.whenOf('26.11 15:00', 'Europe/Moscow', now), 24 * 3600_000);
    assert.strictEqual(remind.whenOf('2h', 'Europe/Moscow', now), 2 * 3600_000);
    assert.strictEqual(remind.stripMentions('<@&123456789012345678> и @everyone'), '@роль и @​everyone');
    await set('reminders', { maxPerUser: 1, minMinutes: 5, dmOnly: true });
    let { i, out } = inter({ sub: 'add', options: { time: '1m', text: 'x' } }); await remind.execute(i);
    assert(json(out.replies[0]).includes('Укажите срок от'), json(out.replies[0]));
    ({ i, out } = inter({ sub: 'add', options: { time: '10m', text: 'позвонить <@&123456789012345678>' } })); await remind.execute(i);
    const r = await db.Reminder.findOne({ where: { userId: 'U1' } });
    assert(r && r.channelId === null && r.text === 'позвонить @роль' && json(out.replies[0]).includes('в личные сообщения'), json(r));
    ({ i, out } = inter({ sub: 'add', options: { time: '10m', text: 'ещё' } })); await remind.execute(i);
    assert(json(out.replies[0]).includes('это предел'), 'the limit of one');
  });

  // ---- the bot's look ----
  const branding = require('../bot/modules/branding');
  const embeds = require('../bot/utils/embeds');
  await test('the bot\'s look: colours by kind, own marks, a footer, the style of dates, private information answers; nothing changes by default', async () => {
    const b = { ...mc.defaults('brand') };
    const plain = { embeds: [embeds.success('ок')] };
    assert.strictEqual(branding.apply(plain, b, 'x'), plain); assert.strictEqual(plain.embeds[0].data.color, embeds.COLORS.success);
    Object.assign(b, { colorSuccess: '#010203', colorError: '#0a0b0c', colorMod: '#ffffff', emojiSuccess: '🟢', footer: 'NO', dateStyle: 'f', ephemeral: true });
    const p = branding.apply({ embeds: [embeds.success('Готово <t:100:R>'), embeds.error('Нет')] }, b, 'balance');
    assert(p.embeds[0].data.color === 0x010203 && p.embeds[0].data.description === '🟢 Готово <t:100:f>' && p.embeds[1].data.color === 0x0a0b0c && p.embeds[0].data.footer.text === 'NO', json(p));
    assert.strictEqual(p.flags, MessageFlags.Ephemeral, 'private /balance');
    assert.strictEqual(branding.apply({ embeds: [embeds.info('x')] }, b, 'poll').flags, undefined, 'not for other commands');
    assert.strictEqual(branding.apply({ embeds: [embeds.success('x')] }, b, 'mod').embeds[0].data.color, 0xffffff, 'moderation colour');
    assert.notStrictEqual(embeds.COLORS.warning, embeds.COLORS.primary, 'a warning and information can be told apart');
  });

  // ---- «where and for whom» before a command ----
  await test('where and for whom: other channels, excluded roles and the pause answer privately; the command runs where allowed', async () => {
    const s = await getOrCreateSettings(G); mc.writeScope(s, 'polls', { allow: [CH], exceptRoles: [ROLE2], cooldown: 30 }); s.pollsEnabled = true; await s.save();
    let ran = 0;
    const handler = require('../bot/events/interactionCreate');
    const run = async ({ channelId = CH, roles = [], user = 'S1' } = {}) => {
      const replies = [];
      const i = { commandName: 'poll', guildId: G, channelId, user: { id: user }, member: { roles: { cache: new Map(roles.map((r) => [r, {}])) } }, channel: { isThread: () => false },
        isAutocomplete: () => false, isChatInputCommand: () => true, isContextMenuCommand: () => false, inGuild: () => true, replied: false, deferred: false,
        client: { commands: new Map([['poll', { execute: async () => { ran++; } }]]) }, reply: async (p) => { replies.push(p); } };
      await handler.execute(i); return replies;
    };
    let r = await run({ channelId: CH2 }); assert(json(r[0]).includes(`<#${CH}>`) && r[0].flags === MessageFlags.Ephemeral && ran === 0, json(r));
    r = await run({ roles: [ROLE2], user: 'S2' }); assert(json(r[0]).includes('недоступна') && ran === 0, json(r));
    await run({ user: 'S3' }); assert.strictEqual(ran, 1);
    r = await run({ user: 'S3' }); assert(json(r[0]).includes('Подождите') && ran === 1, 'the pause');
  });

  // ---- the settings file ----
  const P = require('../web/utils/portability');
  await test('the settings file: no secrets or money; IDs here kept, missing ones found by name, the rest left out and named; a module reset', async () => {
    const s = await getOrCreateSettings(G);
    Object.assign(s, { welcomeChannelId: CH, leaveChannelId: CH2, autoRoleId: ROLE, logWebhookToken: 'secret', treasury: 500 });
    mc.write(s, 'tickets', { supportRoles: [ROLE, ROLE2], panelMessageId: '900000000000000001' }); await s.save();
    const file = P.exportSettings(s, { guild: { id: G, name: 'Old' }, channels: [{ id: CH, name: 'общий', type: 0 }, { id: CH2, name: 'прощания', type: 0 }], roles: [{ id: ROLE, name: 'Админ' }, { id: ROLE2, name: 'Модер' }] });
    assert(!('logWebhookToken' in file.settings) && !('treasury' in file.settings) && !('guildId' in file.settings) && !file.settings.ticketConfig.panelMessageId, 'nothing private');
    const NEW_CH = '810000000000000001', NEW_ROLE = '610000000000000001';
    const r = P.importSettings(JSON.parse(JSON.stringify(file)), { attributes: db.GuildSettings.rawAttributes, channels: [{ id: CH, name: 'общий', type: 0 }, { id: NEW_CH, name: 'прощания', type: 0 }], roles: [{ id: NEW_ROLE, name: 'Админ' }] });
    assert(r.values.welcomeChannelId === CH && r.values.leaveChannelId === NEW_CH && r.values.autoRoleId === NEW_ROLE, JSON.stringify([r.values.welcomeChannelId, r.values.leaveChannelId, r.values.autoRoleId]));
    assert.deepStrictEqual(JSON.parse(r.values.ticketConfig).supportRoles, [NEW_ROLE]);
    assert(r.report.kept >= 1 && r.report.mapped >= 2 && r.report.dropped.some((d) => d.name === 'Модер'), JSON.stringify(r.report));
    assert.throws(() => P.importSettings({ settings: {} }, { attributes: {} }), /не файл настроек/);
    const done = P.resetModule(s, 'tickets', db.GuildSettings.rawAttributes);
    assert(done.includes('ticketConfig') && !done.includes('ticketsEnabled') && mc.read(s, 'tickets').supportRoles.length === 0, done.join());
  });

  // ---- the panel pages ----
  const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.user = { id: 'ADMIN' }; n(); } });
  stub('discordApi.js', {
    getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), getBotGuildIds: async () => new Set([G]),
    getGuildChannels: async () => [{ id: CH, name: 'общий', type: 0 }, { id: CH2, name: 'прощания', type: 0 }], getGuildRoles: async () => [{ id: ROLE, name: 'Админ', position: 1 }]
  });
  stub('botBridge.js', { getClient: () => null, settingsChanged: () => {} });
  require('../web/modules');
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard/modulePages')); app.use('/dashboard', require('../web/routes/dashboard/features'));
  app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  await test('panel: the pages of polls, mini-games and reminders open with their settings, tables and the scope block', async () => {
    for (const [pg, must] of [['polls', ['name="creatorRoles"', 'name="barFull"', '/scope/polls', 'Аноним?']], ['fun', ['name="bets"', 'name="answersGood"', '/scope/fun', 'name="8ball"']], ['reminders', ['name="dmOnly"', 'позвонить', '/reminders/', '/scope/reminders']]]) {
      const r = await fetch(`${base}/${pg}`); const html = await r.text();
      assert.strictEqual(r.status, 200, pg + ' ' + html.slice(0, 300));
      for (const m of must) assert(html.includes(m), pg + ': ' + m);
    }
  });
  await test('panel: a form saves only its fields; errors come back by field; bets «from» and «to» are put in order; a reminder is deleted', async () => {
    let r = await post('/config/fun', { _fields: 'bets,betMin,betMax', bets: 'on', betMin: '500', betMax: '20' });
    let c = mc.read(await getOrCreateSettings(G), 'fun');
    assert(c.bets && c.betMin === 20 && c.betMax === 500 && c.ephemeral === true, JSON.stringify(c));
    r = await post('/config/polls', { _fields: 'maxOptions', maxOptions: '40' });
    assert(r.headers.get('location').includes('invalid=1&err=maxOptions'), r.headers.get('location'));
    r = await post('/config/brand', { _fields: 'colorInfo,footer', colorInfo: 'red', footer: 'x' });
    assert(r.headers.get('location').includes('err=colorInfo'), 'a bad colour');
    r = await post('/config/brand', { _fields: 'colorInfo,footer', colorInfo: '#123456', footer: 'x' });
    c = mc.read(await getOrCreateSettings(G), 'brand'); assert(c.colorInfo === '#123456' && c.footer === 'x', JSON.stringify(c));
    const rem = await db.Reminder.findOne({ where: { guildId: G } });
    r = await post(`/reminders/${rem.id}/delete`, {});
    assert(r.headers.get('location').includes('reminderdeleted') && !(await db.Reminder.findByPk(rem.id)), 'deleted');
  });
  await test('panel: «Базовые настройки» — the look of replies, the file out and in, a module reset', async () => {
    let html = await (await fetch(base + '/settings')).text();
    for (const m of ['name="colorSuccess"', 'name="dateStyle"', '/settings/export', '/settings/import', '/settings/reset-module']) assert(html.includes(m), m);
    const file = await (await fetch(base + '/settings/export')).json();
    assert(file.format === 'dark-settings/1' && file.settings.welcomeChannelId === CH, 'export');
    file.settings.welcomeMessage = 'Из файла';
    let r = await post('/settings/import', { json: JSON.stringify(file) });
    assert(r.headers.get('location').includes('importdone=1&imp='), r.headers.get('location'));
    assert.strictEqual((await getOrCreateSettings(G)).welcomeMessage, 'Из файла');
    html = await (await fetch(r.headers.get('location').replace(/^\/dashboard\/\d+/, base))).text();
    assert(html.includes('найдены по названию'), 'the result is shown');
    r = await post('/settings/import', { json: '{"x":1}' }); assert(r.headers.get('location').includes('invalid'), 'not a settings file');
    r = await post('/settings/reset-module', { module: 'fun' }); assert(r.headers.get('location').includes('moduleReset'));
    assert.strictEqual(mc.read(await getOrCreateSettings(G), 'fun').bets, false);
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
