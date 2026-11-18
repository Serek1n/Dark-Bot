// «Статистика сервера», the wide card format and the own text of achievements: counting by day (nothing lost when the
// database is busy, nothing counted when the module is off), counters in channel names (renamed at most once in ten
// minutes, a deleted channel leaves the list, at most 10), the panel pages; the wide format is 1140 × 302 with the plate
// 16 px from the top/left and 31 px from the bottom/right; the achievement message follows the server's own text.
process.env.DATABASE_PATH = './data/test_serverstats.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');
const { Collection } = require('discord.js');

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings, GuildStatDay } = db;
  const ss = require('../bot/modules/serverStats');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = '777000000000000003';
  await GuildSettings.findOrCreate({ where: { guildId: G } });

  // a small fake server
  const renamed = [];
  const mkChannel = (id, name, extra = {}) => ({ id, name, type: 2, isVoiceBased: () => true, members: new Collection(), permissionsFor: () => ({ has: () => true }),
    async setName(n) { if (extra.fail) throw Object.assign(new Error('Missing Permissions'), { status: 403 }); renamed.push([id, n]); this.name = n; return this; }, ...extra });
  const voice = mkChannel('800000000000000001', 'Общий');
  voice.members = new Collection([['a', { user: { bot: false } }], ['b', { user: { bot: false } }], ['c', { user: { bot: true } }]]);
  const counter = mkChannel('800000000000000002', 'старое');
  const guild = {
    id: G, name: 'Сервер', memberCount: 1234, premiumSubscriptionCount: 3, premiumTier: 1, afkChannelId: null,
    channels: { cache: new Collection([[voice.id, voice], [counter.id, counter]]), fetch: async (id) => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); }, create: async (o) => { const c = mkChannel(String(800000000000000100 + created.length), o.name); created.push(o); guild.channels.cache.set(c.id, c); return c; } },
    roles: { cache: new Collection([[G, {}], ['r1', {}]]), everyone: { id: G } }, emojis: { cache: new Collection() },
    members: { cache: new Collection([['m1', { user: { bot: true } }]]), fetch: async () => null, me: { id: 'BOT', permissions: { has: () => true } } }
  };
  const created = [];
  guild.client = { guilds: { cache: new Map([[G, guild]]), fetch: async () => ({ approximatePresenceCount: 321 }) } };

  await test('counting: messages, joins, leaves, voice minutes go to today; bots and AFK are not counted', async () => {
    for (let i = 0; i < 5; i++) ss.onMessage({ guild, author: { bot: false } });
    ss.onMessage({ guild, author: { bot: true } });
    ss.onJoin({ guild, user: { bot: false } }); ss.onJoin({ guild, user: { bot: true } }); ss.onLeave({ guild, user: { bot: false } });
    ss.sampleVoice(guild.client); ss.sampleVoice(guild.client);
    await ss.flushAll();
    const row = await GuildStatDay.findOne({ where: { guildId: G, day: ss.dayKey() } });
    assert(row && row.messages === 5 && row.joins === 1 && row.leaves === 1 && row.voiceMinutes === 4 && row.voicePeak === 2 && row.members === 1234, JSON.stringify(row?.get()));
    ss.onMessage({ guild, author: { bot: false } }); await ss.flushAll();
    assert((await row.reload()).messages === 6, 'added, not replaced');
  });

  await test('the database busy once: the counts wait for the next minute, nothing is lost', async () => {
    const orig = db.inTransaction; let once = true;
    db.inTransaction = (w) => (once ? (once = false, Promise.reject(new Error('SQLITE_BUSY'))) : orig(w));
    for (let i = 0; i < 3; i++) ss.onMessage({ guild, author: { bot: false } });
    await ss.flushAll(); await ss.flushAll();
    db.inTransaction = orig;
    const row = await GuildStatDay.findOne({ where: { guildId: G, day: ss.dayKey() } });
    assert(row.messages === 9, 'messages ' + row.messages);
  });

  await test('history: every day of the period is there (zeros where nothing was counted), today last', async () => {
    const h = await ss.history(G, 7);
    assert(h.length === 7 && h[6].day === ss.dayKey() && h[6].messages === 9 && h[0].messages === 0, JSON.stringify(h.map((d) => d.messages)));
  });

  await test('the module off: nothing is written', async () => {
    const G2 = '777000000000000004';
    await GuildSettings.create({ guildId: G2, serverStatsEnabled: false });
    ss.onMessage({ guild: { id: G2 }, author: { bot: false } });
    await ss.flushAll();
    assert(await GuildStatDay.count({ where: { guildId: G2 } }) === 0, 'written');
  });

  await test('values and names: numbers with spaces, humans/bots, online asked from Discord, 100 characters at most', async () => {
    const v = await ss.values(guild);
    assert(v.members === 1234 && v.voice === 2 && v.online === 321 && v.bots === 1 && v.boosts === 3 && v.roles === 1, JSON.stringify(v));
    assert(ss.renderName('👥 Участники: {members}', v) === '👥 Участники: 1 234', ss.renderName('👥 Участники: {members}', v));
    assert(ss.renderName('x'.repeat(150), v).length === 100, 'cut');
  });

  await test('counters: renamed only when the text changes, not twice in ten minutes; a deleted channel leaves the list', async () => {
    const s = await GuildSettings.findByPk(G);
    ss.write(s, { counters: [{ channelId: counter.id, template: 'Участники: {members}' }, { channelId: '800000000000000099', template: '{voice}' }] }); await s.save();
    await ss.refreshGuild(guild);
    assert(renamed.length === 1 && renamed[0][1] === 'Участники: 1 234', JSON.stringify(renamed));
    assert(ss.read(await GuildSettings.findByPk(G)).counters.length === 1, 'the deleted channel was struck out');
    guild.memberCount = 1240;
    await ss.refreshGuild(guild);
    assert(renamed.length === 1, 'not again within ten minutes');
    await ss.refreshGuild(guild, { force: true });
    assert(renamed.length === 1, 'even forced: not twice a minute');
  });

  await test('counters: a channel the bot may not rename stays, the panel gets the reason', async () => {
    const bad = mkChannel('800000000000000003', 'x', { fail: true });
    guild.channels.cache.set(bad.id, bad);
    const s = await GuildSettings.findByPk(G);
    const cfg = ss.read(s); cfg.counters.push({ channelId: bad.id, template: '{members}' }); ss.write(s, cfg); await s.save();
    await ss.refreshGuild(guild);
    assert(ss.problems.get(bad.id) && /не дал/.test(ss.problems.get(bad.id)), 'reason');
    assert(ss.read(await GuildSettings.findByPk(G)).counters.some((c) => c.channelId === bad.id), 'kept');
  });

  await test('create: a voice channel nobody can join, in a new category; at most 10', async () => {
    const s = await GuildSettings.findByPk(G);
    const r = await ss.createCounter(guild, s, '🎙️ {voice}');
    assert(r.ok, r.error);
    const ch = created.find((o) => o.type === 2);
    assert(ch && ch.permissionOverwrites[0].deny.length === 1 && created[0].type === 4, 'locked voice in a category');
    const cfg = ss.read(await GuildSettings.findByPk(G));
    assert(cfg.categoryId && cfg.counters.length === 3, JSON.stringify(cfg));
    cfg.counters = Array.from({ length: 10 }, (_, i) => ({ channelId: String(810000000000000000 + i), template: '{members}' }));
    ss.write(s, cfg); await s.save();
    const r2 = await ss.createCounter(guild, s, '{members}');
    assert(!r2.ok && r2.code === 'max', 'limit');
  });

  // ---- the wide format ----
  await test('wide format: 1140 × 302 (at twice the pixels), transparent margins 16 / 31, the plate is drawn', async () => {
    const { loadImage } = require('@napi-rs/canvas');
    const ach = require('../bot/modules/achievements');
    const png = await ach.renderCard({ achievement: { name: 'Болтун', description: 'x', rarity: 'rare', category: 'messages' }, userName: 'Ann', format: 'wide' });
    const img = await loadImage(png);
    assert(img.width === 2280 && img.height === 604, img.width + '×' + img.height);
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const alpha = (px, py) => x.getImageData(px, py, 1, 1).data[3];
    assert(alpha(4, 4) === 0 && alpha(2270, 300) < 255 && alpha(2 * 16 + 40, 2 * 16 + 40) === 255 && alpha(2 * (1140 - 31) - 40, 2 * (302 - 31) - 40) === 255, 'margins and plate');
    const lv = await require('../bot/modules/lookCards').renderLevelUpCard({ username: 'Ann', level: 5, format: 'wide' });
    const li = await loadImage(lv); assert(li.width === 2280 && li.height === 604, 'level-up wide');
    const ap = require('../bot/modules/appearance');
    const s = { appearance: '{}' };
    ap.applyForm(s, { achievement_card: 'on', achievement_format: 'wide', levelUp_text: 'on', levelUp_format: 'bogus' }, ['achievement', 'levelUp']);
    const l = ap.read(s);
    assert(l.targets.achievement.format === 'wide' && l.targets.levelUp.format === 'classic' && l.targets.profile.format === undefined, JSON.stringify(l.targets));
  });

  // ---- the achievement message ----
  await test('achievement text: own text with names, empty lines dropped, no ping, own button labels, theme colour', async () => {
    const ach = require('../bot/modules/achievements');
    const g = { id: G, name: 'Dark', iconURL: () => null, client: { users: { fetch: async () => null } } };
    const a = { name: 'Болтун', description: 'Тысяча', rarity: 'rare', category: 'messages', reward: { coins: 500 } };
    const st = { appearance: JSON.stringify({ targets: { achievement: { card: false, text: true, frame: true } } }), achievementsMessage: '🎉 {name} — {achievement}\n{reward_line}\n{role}\n{server}',
      achievementsMsgOptions: JSON.stringify({ ping: false, buttons: true, mine: 'Мои', all: 'Все', color: 'theme' }) };
    const m = await ach.cardMessage(g, { id: 'u1', displayName: 'Ann', user: { id: 'u1', displayAvatarURL: () => null } }, 'u1', [a], st);
    assert(m.embeds[0].data.description === '🎉 Ann — Болтун\nНаграда: 500 монет\nDark', m.embeds[0].data.description);
    assert(!m.content && m.allowedMentions.parse.length === 0, 'no ping');
    assert(m.components[0].components.map((b) => b.data.label).join() === 'Мои,Все', 'labels');
    assert(m.embeds[0].data.color === 0xe3a857, 'theme colour');
    const off = await ach.cardMessage(g, null, 'u1', [a], { ...st, achievementsMsgOptions: JSON.stringify({ buttons: false }) });
    assert(off.components.length === 0 && off.content === '<@u1>', 'no buttons, ping by default');
    const def = await ach.cardMessage(g, null, 'u1', [a], { appearance: st.appearance });
    assert(def.embeds[0].data.description.startsWith('<@u1> открывает достижение **Болтун**!'), 'default text');
  });

  // ---- the panel ----
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;

  await test('panel: «Статистика сервера» — overview (7/30/90 days, charts with tables), counters; the achievement text is saved', async () => {
    for (const p of ['server-stats', 'server-stats?days=7', 'server-stats?days=90', 'server-stats-channels', 'achievements-settings']) {
      const r = await fetch(`${base}/${p}`); const t = await r.text();
      assert(r.status === 200, p + ' ' + r.status + ' ' + t.slice(0, 300));
      if (p.startsWith('server-stats?')) assert(t.includes('class="sc-svg"') && t.includes('<summary>Таблица</summary>'), 'charts');
    }
    const M = require('../web/modules');
    assert(M.MODULES.find((m) => m.key === 'serverStats').group === 'server', 'module listed');
    const post = (page, body) => fetch(`${base}/${page}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const r = await post('achievements/settings', { achievementsNotify: 'auto', achievementsBalanceGoal: '5000', achievementsMessage: '{user} — {achievement}', achButtons: 'on', achMine: 'Мои', achAll: '', achColor: 'theme' });
    assert(r.status === 302, 'saved ' + r.status);
    const s = await GuildSettings.findByPk(G);
    const o = require('../bot/modules/achievements').msgOptions(s);
    assert(s.achievementsMessage === '{user} — {achievement}' && !o.ping && o.buttons && o.mine === 'Мои' && o.all === 'Все достижения' && o.color === 'theme', JSON.stringify(o));
    const pv = await fetch(`${base}/achievements/preview-text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '{achievement}: {reward_line}\n{role}' }) });
    assert((await pv.json()).text === 'Болтун: Награда: 500 монет, 3 кристаллов', 'preview');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
