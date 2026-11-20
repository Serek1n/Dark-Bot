// Discord's rules for apps: a person can see and delete his data, turn off optional private messages; the catalog takes
// no 18+ servers; channels hidden from the bot are not listed; kept copies of reported messages and the data of a server
// the bot left do not stay forever. Plus the legal pages tell what really is kept.
process.env.DATABASE_PATH = './data/test_privacy.sqlite';
process.env.MEDIA_DIR = './data/test_media_privacy';
process.env.WEB_BASE_URL = 'https://dark.example';
const path = require('path');
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
fs.rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });

(async () => {
  const db = require('../db'); await db.init();
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const ME = '700000000000000201'; const OTHER = '700000000000000202'; const MOD = '700000000000000203';
  const G = '800000000000000101'; const G18 = '800000000000000102';
  const ud = require('../bot/modules/userData');
  const cm = require('../bot/modules/communities');
  const guilds = new Map([[G, { id: G, name: 'Обычный', nsfwLevel: 0, memberCount: 50, members: { fetch: async () => ({ joinedTimestamp: 0 }) } }], [G18, { id: G18, name: 'Взрослый', nsfwLevel: 3, memberCount: 50 }]]);
  require('../web/botBridge').setClient({ guilds: { cache: guilds }, isReady: () => true });
  cm.verifyInvite = async () => ({ name: null });
  await cm.setPlatform('700000000000000001', { premoderation: false }).catch(() => {});

  // what a person leaves behind on a server and in the catalog
  await db.MemberProfile.create({ guildId: G, userId: ME, xp: 500, level: 3, balance: 90 });
  await db.Reminder.create({ userId: ME, guildId: G, channelId: null, text: 'полить цветы', remindAt: new Date(Date.now() + 3600e3) }).catch(() => {});
  await db.Warning.create({ guildId: G, userId: ME, moderatorId: MOD, reason: 'спам' });
  await db.MemberProfile.create({ guildId: G, userId: OTHER, xp: 10 });
  await cm.save(G, OTHER, { name: 'Обычный', shortDesc: 'Дружное сообщество для тестов', categories: ['gaming'], tags: 'test', inviteUrl: 'https://discord.gg/abc1' });
  const c = await db.Community.findOne({ where: { guildId: G } });
  await db.CommunityReview.create({ communityId: c.id, userId: ME, rating: 5, text: 'Отлично', status: 'published' });
  await db.Community.update({ ratingSum: 5, ratingCount: 1 }, { where: { id: c.id } });
  await db.CommunityVote.create({ communityId: c.id, userId: ME, day: '2026-11-20' }).catch(() => {});
  await db.DarkWallet.create({ userId: ME, balance: 300 });

  await test('my data: counts by table, a file with every row about me (moderation records included)', async () => {
    const s = await ud.summary(ME);
    assert(s.MemberProfile === 1 && s.Warning === 1 && s.CommunityReview === 1 && s.DarkWallet === 1 && !s.Community, JSON.stringify(s));
    const x = await ud.exportData(ME);
    assert(x.userId === ME && x.tables.MemberProfile[0].xp == 500 && x.tables.Warning[0].reason === 'спам' && !x.tables.Community, Object.keys(x.tables).join());
  });

  await test('deleting my data: my activity goes, the rating is corrected, moderation records and other people stay', async () => {
    const done = await ud.erase(ME);
    assert(done.MemberProfile === 1 && done.CommunityReview === 1 && done.DarkWallet === 1, JSON.stringify(done));
    assert(!(await db.MemberProfile.findOne({ where: { userId: ME } })) && await db.Warning.count({ where: { userId: ME } }) === 1, 'warning kept');
    assert(await db.MemberProfile.count({ where: { userId: OTHER } }) === 1, 'others untouched');
    const fresh = await db.Community.findByPk(c.id);
    assert(fresh.ratingCount === 0 && fresh.ratingSum === 0, 'rating ' + fresh.ratingSum + '/' + fresh.ratingCount);
  });

  await test('a frozen DARK Coins wallet is not deleted (it would wipe a sanction)', async () => {
    await db.DarkWallet.create({ userId: OTHER, balance: 50, frozen: true });
    await ud.erase(OTHER);
    assert(await db.DarkWallet.count({ where: { userId: OTHER } }) === 1, 'frozen kept');
  });

  await test('optional DMs: sent with a «don\'t send» button; off — not sent; the button turns them off and back on', async () => {
    const got = [];
    const user = { id: ME, send: async (p) => { got.push(p); return p; } };
    await ud.sendOptionalDm(user, { content: 'Уровень 5!' });
    assert(got.length === 1 && got[0].components[0].components[0].data.custom_id === 'dmpref:off', JSON.stringify(got[0]));
    let reply = null;
    const press = (id) => ({ isButton: () => true, customId: id, user: { id: ME }, guildId: null, reply: async (r) => { reply = r; } });
    assert(ud.isDmPrefButton(press('dmpref:off')), 'recognised');
    await ud.handleDmPrefButton(press('dmpref:off'));
    assert(/больше не пришлю/.test(reply.content) && !(await ud.dmAllowed(ME)), 'off');
    await ud.sendOptionalDm(user, 'ещё уровень');
    assert(got.length === 1, 'not sent when off');
    await ud.handleDmPrefButton(press('dmpref:on'));
    assert(await ud.dmAllowed(ME), 'on again');
  });

  await test('level-ups and achievements in DM go through the opt-out', () => {
    const src = ['bot/utils/levelUp.js', 'bot/modules/achievements.js', 'bot/modules/tempRoles.js', 'bot/modules/tempRooms.js'].map((f) => fs.readFileSync(f, 'utf8'));
    src.forEach((s, i) => assert(s.includes('sendOptionalDm'), 'file ' + i));
  });

  await test('the catalog takes no 18+ server, and hides one marked 18+ later', async () => {
    let msg = '';
    try { await cm.save(G18, OTHER, { name: 'x', shortDesc: 'Сервер для взрослых людей', categories: ['gaming'], inviteUrl: 'https://discord.gg/abc2' }); } catch (e) { msg = e.message; }
    assert(/18\+/.test(msg), msg);
    guilds.get(G).nsfwLevel = 1;
    const list = await cm.catalog({});
    assert(list.total === 0 && !list.items.some((r) => r.guildId === G), "hidden from the catalog");
    guilds.get(G).nsfwLevel = 0;
  });

  await test('channels hidden from the bot (Discord sends «___hidden___» with flag 1<<17) are not listed in the panel', async () => {
    const api = require('../web/discordApi');
    assert(api.isHidden({ name: '___hidden___', flags: 0 }) && api.isHidden({ name: 'x', flags: { bitfield: 1 << 17 } }) && !api.isHidden({ name: 'general', flags: 0 }), 'isHidden');
  });

  await test('the copy of a reported message is wiped 90 days after the decision; open reports keep it', async () => {
    const old = new Date(Date.now() - 100 * 86400e3);
    const done = await db.Report.create({ guildId: G, reporterId: OTHER, targetId: ME, category: 'spam', reason: 'r', messageText: 'текст', status: 'done' });
    const open = await db.Report.create({ guildId: G, reporterId: OTHER, targetId: ME, category: 'spam', reason: 'r', messageText: 'текст', status: 'open' });
    await db.sequelize.query('UPDATE reports SET updatedAt = ? WHERE id IN (?, ?)', { replacements: [old.toISOString(), done.id, open.id] }).catch(() => db.Report.update({ updatedAt: old }, { where: {}, silent: true }));
    await require('../bot/modules/memberRestore').forgetReportTexts();
    assert((await db.Report.findByPk(done.id)).messageText === null && (await db.Report.findByPk(open.id)).messageText === 'текст', 'wiped only the decided one');
  });

  await test('a server the bot left 14 days ago: its catalog card, reviews and pictures go too', async () => {
    const media = require('../bot/modules/communityMedia');
    const { createCanvas } = require('@napi-rs/canvas');
    const cv = createCanvas(20, 20); cv.getContext('2d').fillRect(0, 0, 20, 20);
    const pic = await media.store(G, cv.toBuffer('image/png'));
    await db.Community.update({ bannerUrl: pic }, { where: { id: c.id } });
    await db.CommunityReview.create({ communityId: c.id, userId: OTHER, rating: 4, text: 'норм', status: 'published' });
    await db.GuildSettings.upsert({ guildId: G, leftAt: new Date(Date.now() - 15 * 86400e3) });
    guilds.delete(G);
    await require('../bot/modules/guildBackup').purgeExpired({ guilds: { cache: guilds } });
    assert(!(await db.Community.findByPk(c.id)) && await db.CommunityReview.count({ where: { communityId: c.id } }) === 0, 'catalog rows');
    assert(!fs.existsSync(media.fileOf(pic)), 'picture file');
  });

  // ---- pages ----
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  let who = ME;
  app.use((req, res, next) => { req.user = who ? { id: who, username: 'u' } : null; res.locals.user = req.user; req.isAuthenticated = () => Boolean(who); next(); });
  app.use('/me', require('../web/routes/me'));
  app.use('/', require('../web/routes/legal'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  await test('page «Мои данные»: the list, the file to download, DMs on/off, deleting only with the word УДАЛИТЬ', async () => {
    await db.MemberProfile.create({ guildId: '800000000000000103', userId: ME, xp: 7 });
    let t = await (await fetch(base + '/me')).text();
    ['Уровни, опыт и монеты на серверах', 'Ваши настройки', '/me/export', 'Что останется и почему'].forEach((s) => assert(t.includes(s), 'page: ' + s + ' ' + (t.match(/<li>.*?<\/li>/g) || []).join(' ').slice(0, 300)));
    const f = await fetch(base + '/me/export');
    assert(/attachment; filename="dark-my-data-/.test(f.headers.get('content-disposition')) && (await f.json()).tables.MemberProfile.length === 1, 'export');
    let r = await post('/me/dm', { dm: 'off' });
    assert(/done=dmoff/.test(r.headers.get('location')) && !(await ud.dmAllowed(ME)), 'dm off');
    r = await post('/me/delete', { confirm: 'да' });
    assert(/err=/.test(r.headers.get('location')) && await db.MemberProfile.count({ where: { userId: ME } }) === 1, 'needs the word');
    r = await post('/me/delete', { confirm: 'удалить' });
    assert(/done=deleted/.test(r.headers.get('location')) && await db.MemberProfile.count({ where: { userId: ME } }) === 0, 'deleted');
    who = null;
    r = await fetch(base + '/me', { redirect: 'manual' });
    assert(r.status === 302 || r.status === 401, 'signed in only ' + r.status);
  });

  await test('legal pages tell what is really kept and link to «Мои данные»', async () => {
    const p = await (await fetch(base + '/privacy')).text();
    ['хеш IP-адреса', 'копия текста этого сообщения', 'через 14 дней', 'Telegram', 'href="/me"', '18+', 'не связан с Discord'].forEach((s) => assert(p.includes(s), 'privacy: ' + s));
    const t = await (await fetch(base + '/terms')).text();
    ['DARK Coins', 'не имеют денежной стоимости', 'Каталог сообществ', 'азартные игры', 'не связан с Discord'].forEach((s) => assert(t.includes(s), 'terms: ' + s));
  });

  server.close();
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  await db.sequelize.close().catch(() => {});
  fs.rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
