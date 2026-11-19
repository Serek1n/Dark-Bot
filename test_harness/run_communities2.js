// «Сообщества», second part: reviews (only members of a day, not the owner; marks stay right after edits, deletes and
// moderation), the admins' answers, complaints about reviews, favourites, the catalog's new filters and sorts, rules,
// links and screenshots of a listing, voting from Discord with a reminder, and the pages that show all of it.
process.env.DATABASE_PATH = './data/test_communities2.sqlite';
process.env.BOT_OWNER_IDS = '700000000000000001';
process.env.WEB_BASE_URL = 'https://dark.example';
process.env.MEDIA_DIR = './data/test_media_communities';
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '810000000000000001', name: 'отзывы', type: 0 }], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'Сервер', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'U' + String(id).slice(-2), avatar: '' }])), botApi: {} });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
fs.rmSync(process.env.MEDIA_DIR, { recursive: true, force: true });

(async () => {
  const db = require('../db'); await db.init();
  const cm = require('../bot/modules/communities');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const fails = async (f, re) => { try { await f(); } catch (e) { assert(re.test(e.message), e.message); return; } throw new Error('did not fail'); };
  const OWNER = '700000000000000001'; const ADMIN = '700000000000000002';
  // old enough Discord accounts (ids from 2020) and a fresh one
  const U1 = '700000000000000101'; const U2 = '700000000000000102'; const U3 = '700000000000000103'; const NEWBIE = String((BigInt(Date.now() - 1420070400000) << 22n) + 1n);
  const G1 = '800000000000000001'; const G2 = '800000000000000002'; const G3 = '800000000000000003';
  const day = 86400000;
  // the bot sees the servers: who is a member and since when
  const members = { [U1]: Date.now() - 3 * day, [U2]: Date.now() - 3 * day, [U3]: Date.now() - 3600000, [ADMIN]: Date.now() - 30 * day };
  const sent = [];
  const guild = (id, n) => ({ id, name: 'Сервер ' + n, memberCount: n * 100, icon: null, ownerId: ADMIN, premiumSubscriptionCount: 4, premiumTier: 1,
    members: { fetch: async (u) => { if (!members[u]) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return { id: u, joinedTimestamp: members[u] }; } },
    channels: { cache: new Map([['810000000000000001', { send: async (m) => { sent.push(m); } }]]) },
    client: { guilds: { fetch: async () => ({ approximatePresenceCount: 42 }) } } });
  const guilds = new Map([[G1, guild(G1, 1)], [G2, guild(G2, 20)], [G3, guild(G3, 3)]]);
  require('../web/botBridge').setClient({ guilds: { cache: guilds }, isReady: () => true });
  cm.verifyInvite = async () => ({ name: null });
  // no network here: «downloading» a link gives a small picture of its own, or the answer Discord gives for an old link
  const media = require('../bot/modules/communityMedia');
  const { createCanvas } = require('@napi-rs/canvas');
  const png = (w, h, color = '#f80') => { const cv = createCanvas(w, h); const x = cv.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return cv.toBuffer('image/png'); };
  media.importUrl = async (guildId, url) => {
    if (/expired/.test(url)) throw new media.MediaError('Ссылка на картинку устарела (Discord выдаёт такие ссылки на сутки). Загрузите картинку файлом.');
    if (!/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\//.test(url)) throw new media.MediaError('Картинки по ссылке — только с cdn.discordapp.com, media.discordapp.net, i.imgur.com. Или загрузите файл.');
    return media.store(guildId, png(40 + url.length % 50, 30, '#' + (url.length * 99999).toString(16).slice(0, 6).padEnd(6, '0')));
  };
  await cm.setPlatform(OWNER, { premoderation: false });
  const form = (n, extra = {}) => ({ name: 'Сервер ' + n, shortDesc: 'Дружное сообщество номер ' + n, categories: ['gaming'], tags: 'minecraft', inviteUrl: 'https://discord.gg/abc' + n, ...extra });

  let c1; let c2; let c3;
  await test('listing: rules, up to four https links, up to six screenshots from allowed hosts, a channel for reviews', async () => {
    await fails(() => cm.save(G1, ADMIN, form(1, { linkUrl: ['http://x.y'] })), /https/);
    await fails(() => cm.save(G1, ADMIN, form(1, { linkUrl: ['https://a.b', 'https://c.d', 'https://e.f', 'https://g.h', 'https://i.j'], linkLabel: [] })), /четырёх/);
    await fails(() => cm.save(G1, ADMIN, form(1, { gallery: 'https://evil.com/a.png' })), /Скриншот/);
    await fails(() => cm.save(G1, ADMIN, form(1, { gallery: Array.from({ length: 7 }, (_, i) => `https://i.imgur.com/${i}.png`).join('\n') })), /шести/);
    await cm.save(G1, ADMIN, form(1, { rules: 'Без спама\n\n  Уважайте друг друга  ', linkLabel: ['Сайт', ''], linkUrl: ['https://dark.example/', 'https://www.youtube.com/@dark'], gallery: 'https://i.imgur.com/a.png\nhttps://cdn.discordapp.com/b.png', notifyChannelId: '810000000000000001' }));
    c1 = await cm.one((await db.Community.findOne({ where: { guildId: G1 } })).id);
    assert(c1.ruleList.join('|') === 'Без спама|Уважайте друг друга', c1.ruleList.join('|'));
    assert(c1.linkList.length === 2 && c1.linkList[1].label === 'youtube.com', JSON.stringify(c1.linkList));
    assert(c1.galleryList.length === 2 && c1.galleryList.every((u) => media.isLocal(u) && fs.existsSync(media.fileOf(u))) && c1.notifyChannelId === '810000000000000001', 'gallery kept by the bot: ' + c1.galleryList);
    await fails(() => cm.save(G1, ADMIN, form(1, { gallery: 'https://cdn.discordapp.com/attachments/1/2/expired.png' })), /Скриншот 1: Ссылка на картинку устарела/);
    await fails(() => cm.save(G1, ADMIN, form(1, { gallery: `/communities/media/${G2}/${'a'.repeat(20)}.webp` })), /другому серверу/);
    // a save without one of the pictures removes its file
    const gone = c1.galleryList[0];
    await cm.save(G1, ADMIN, form(1, { gallery: c1.galleryList[1], notifyChannelId: '810000000000000001', rules: 'Без спама\nУважайте друг друга', linkLabel: ['Сайт', ''], linkUrl: ['https://dark.example/', 'https://www.youtube.com/@dark'] }));
    assert(!fs.existsSync(media.fileOf(gone)) && fs.existsSync(media.fileOf(c1.galleryList[1])), 'unused picture removed');
    await cm.save(G1, ADMIN, form(1, { gallery: c1.galleryList[1] + '\nhttps://i.imgur.com/x.png', notifyChannelId: '810000000000000001', rules: 'Без спама\nУважайте друг друга', linkLabel: ['Сайт', ''], linkUrl: ['https://dark.example/', 'https://www.youtube.com/@dark'] }));
    c1 = await cm.one(c1.id);
    await cm.save(G2, ADMIN, form(2, { categories: ['gaming', 'social'], tags: 'pvp' }));
    await cm.save(G3, ADMIN, form(3, { categories: ['music'] }));
    c2 = await db.Community.findOne({ where: { guildId: G2 } }); c3 = await db.Community.findOne({ where: { guildId: G3 } });
  });

  await test('pictures: only real images are kept, drawn anew as WebP at most 1920 px; anything else is refused', async () => {
    await fails(() => media.store(G3, Buffer.from('<svg onload=alert(1)></svg>          ')), /Это не картинка/);
    await fails(() => media.store(G3, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])), /не удалось прочитать/);
    await fails(() => media.store(G3, Buffer.alloc(9 * 1024 * 1024, 1)), /больше 8 МБ/);
    const u = await media.store(G3, png(3000, 1000));
    const out = fs.readFileSync(media.fileOf(u));
    assert(media.kindOf(out) === 'webp', 'webp');
    const { loadImage } = require('@napi-rs/canvas'); const im = await loadImage(out);
    assert(im.width === 1920 && im.height === 640, im.width + '×' + im.height);
    assert(await media.store(G3, png(3000, 1000)) === u, 'the same picture is kept once');
    await media.prune(G3, []);
    assert(!fs.existsSync(media.fileOf(u)), 'pruned');
  });

  await test('old Discord links in cards are taken in once; dead ones are dropped', async () => {
    await db.Community.update({ bannerUrl: 'https://cdn.discordapp.com/banner.png', gallery: JSON.stringify(['https://media.discordapp.net/a.png', 'https://cdn.discordapp.com/attachments/expired.png']) }, { where: { id: c3.id } });
    await cm.adoptOldPictures();
    const r = await db.Community.findByPk(c3.id);
    assert(media.isLocal(r.bannerUrl) && JSON.parse(r.gallery).length === 1 && media.isLocal(JSON.parse(r.gallery)[0]), r.bannerUrl + ' ' + r.gallery);
  });

  await test('reviews: not from a fresh account, not from someone who is not a member, not before a day on the server, not the owner', async () => {
    await fails(() => cm.saveReview(c1.id, NEWBIE, { rating: 5 }), /старше 7 дней/);
    await fails(() => cm.saveReview(c1.id, '700000000000000199', { rating: 5 }), /участники сервера/);
    await fails(() => cm.saveReview(c1.id, U3, { rating: 5 }), /через сутки/);
    await fails(() => cm.saveReview(c1.id, ADMIN, { rating: 5 }), /Свой сервер/);
    await fails(() => cm.saveReview(c1.id, U1, { rating: 7 }), /от 1 до 5/);
    await fails(() => cm.saveReview(c1.id, U1, { rating: 4, text: 'мало' }), /10 символов/);
  });

  await test('reviews: marks add up; an edit changes the mark, a delete takes it away; the channel is told about a new one', async () => {
    await cm.saveReview(c1.id, U1, { rating: 5, text: 'Отличный сервер, всем советую!' });
    await cm.saveReview(c1.id, U2, { rating: 3 });
    let c = await db.Community.findByPk(c1.id);
    assert(c.ratingSum === 8 && c.ratingCount === 2 && cm.rating(c) === 4, `${c.ratingSum}/${c.ratingCount}`);
    await cm.saveReview(c1.id, U2, { rating: 1, text: 'Передумал, стало хуже' });
    c = await c.reload();
    assert(c.ratingSum === 6 && c.ratingCount === 2, `edit ${c.ratingSum}/${c.ratingCount}`);
    assert(await db.CommunityReview.count({ where: { communityId: c1.id } }) === 2, 'one review per person');
    await new Promise((r) => setTimeout(r, 50));
    assert(sent.length === 2 && /★★★★★/.test(sent[0].embeds[0].data.title) && sent[0].embeds[0].data.url.endsWith('#reviews'), 'told twice: two new reviews, not the edit');
    await cm.deleteReview(c1.id, U2);
    c = await c.reload();
    assert(c.ratingSum === 5 && c.ratingCount === 1, `delete ${c.ratingSum}/${c.ratingCount}`);
    const r = await cm.reviewsOf(c1.id, { userId: U1 });
    assert(r.total === 1 && r.dist[4] === 1 && r.mine && r.mine.rating === 5, JSON.stringify(r.dist));
  });

  await test('answers and complaints: the admins answer; a complaint once per person; the platform hides (mark gone) and restores', async () => {
    const rv = await db.CommunityReview.findOne({ where: { communityId: c1.id, userId: U1 } });
    await fails(() => cm.replyReview(G2, rv.id, ADMIN, 'чужой'), /не найден/);
    await cm.replyReview(G1, rv.id, ADMIN, 'Спасибо!');
    assert((await rv.reload()).reply === 'Спасибо!' && rv.replyBy === ADMIN, 'reply');
    await cm.reportReview(rv.id, U2, 'Это реклама другого сервера');
    await fails(() => cm.reportReview(rv.id, U2, 'Ещё раз жалуюсь'), /уже жаловались/);
    assert((await rv.reload()).reports === 1, 'reports');
    await fails(() => cm.moderateReview(ADMIN, rv.id, 'hide'), /модерация платформы/);
    await cm.moderateReview(OWNER, rv.id, 'hide');
    let c = await db.Community.findByPk(c1.id);
    assert(c.ratingCount === 0 && c.ratingSum === 0 && cm.rating(c) === null, 'hidden: not counted');
    assert((await cm.reviewsOf(c1.id)).total === 0 && (await cm.reviewsOf(c1.id, { all: true })).total === 1, 'hidden from the page, seen by the admins');
    await cm.moderateReview(OWNER, rv.id, 'restore');
    c = await c.reload();
    assert(c.ratingCount === 1 && c.ratingSum === 5 && (await rv.reload()).reports === 0, 'restored');
  });

  await test('favourites: on and off; only published ones', async () => {
    assert(await cm.toggleFavorite(U1, c2.id) === true, 'on');
    assert((await cm.favoriteIds(U1)).has(c2.id), 'listed');
    assert(await cm.toggleFavorite(U1, c2.id) === false, 'off');
    await cm.toggleFavorite(U1, c3.id);
    await cm.setVisible(G1, false);
    await fails(() => cm.toggleFavorite(U1, c1.id), /не найдено/);
    await cm.setVisible(G1, true);
  });

  await test('catalog: tag, size, rating, favourites; sorts by marks and «growing»; the growing row on the front page', async () => {
    let r = await cm.catalog({ tag: 'pvp' });
    assert(r.items.length === 1 && r.items[0].id === c2.id, 'tag');
    r = await cm.catalog({ size: 'l' });
    assert(r.items.map((c) => c.id).join() === String(c2.id), 'size > 1000: ' + r.items.map((c) => c.memberCount));
    r = await cm.catalog({ minRating: 4 });
    assert(r.items.length === 1 && r.items[0].id === c1.id, 'rating ≥ 4');
    r = await cm.catalog({ favIds: await cm.favoriteIds(U1) });
    assert(r.items.length === 1 && r.items[0].id === c3.id, 'favourites');
    r = await cm.catalog({ sort: 'rating' });
    assert(r.items[0].id === c1.id, 'by marks first: ' + r.items.map((c) => c.name));
    await db.CommunityStat.create({ communityId: c3.id, day: new Date().toISOString().slice(0, 10), votes: 5, clicks: 9, views: 50 });
    await new Promise((res) => setTimeout(res, 10));
    r = await cm.catalog({ sort: 'trending' });
    // the week's activity is kept for a minute: the first call above may have read it empty
    assert(r.items.length === 3, 'all three');
  });

  await test('the page: online and boosts from Discord, similar communities by category', async () => {
    const x = await cm.liveExtra(c1);
    assert(x.online === 42 && x.boosts === 4 && x.tier === 1, JSON.stringify(x));
    const sim = await cm.similar(await db.Community.findByPk(c1.id, { raw: true }));
    assert(sim.length === 1 && sim[0].id === c2.id, 'gaming → gaming: ' + sim.map((s) => s.name));
  });

  await test('Discord /vote: the button votes (12 h rule), the reminder is set once', async () => {
    const replies = [];
    const i = (id, user = U2) => ({ isButton: () => true, customId: id, user: { id: user }, reply: async (m) => { replies.push(m); } });
    assert(cm.isCommunityButton(i(`cmvote:${c1.id}`)) && !cm.isCommunityButton(i('other:1')), 'matches');
    await cm.handleCommunityButton(i(`cmvote:${c1.id}`));
    assert(/учтён/.test(replies[0].embeds[0].data.description) && replies[0].components[0].components[0].data.custom_id === `cmremind:${c1.id}`, 'voted');
    await cm.handleCommunityButton(i(`cmvote:${c1.id}`));
    assert(/уже голосовали/.test(replies[1].embeds[0].data.description), 'not twice');
    await cm.handleCommunityButton(i(`cmremind:${c1.id}`));
    await cm.handleCommunityButton(i(`cmremind:${c1.id}`));
    assert(await db.Reminder.count({ where: { userId: U2 } }) === 1 && /уже стоит/.test(replies[3].embeds[0].data.description), 'one reminder');
    const rem = await db.Reminder.findOne({ where: { userId: U2 } });
    assert(rem.text.includes('https://dark.example/communities/' + c1.id) && rem.channelId === null, rem.text);
    const card = require('../bot/commands/utility/vote').card(await cm.forGuild(G1));
    assert(card.components[0].components.length === 2 && card.embeds[0].data.fields.length === 3, 'card');
  });

  await test('removing a listing removes its reviews, complaints and favourites too', async () => {
    const rv = await db.CommunityReview.findOne({ where: { communityId: c1.id } });
    await cm.reportReview(rv.id, U2, 'Снова жалоба на отзыв');
    await cm.toggleFavorite(U2, c1.id);
    await cm.remove(G1);
    assert(await db.CommunityReview.count({ where: { communityId: c1.id } }) === 0 && await db.CommunityReviewReport.count({ where: { reviewId: rv.id } }) === 0 && await db.CommunityFavorite.count({ where: { communityId: c1.id } }) === 0, 'cleaned');
    await cm.save(G1, ADMIN, form(1));
    c1 = await cm.one((await db.Community.findOne({ where: { guildId: G1 } })).id);
  });

  // ---- pages ----
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  let who = U1;
  app.use((req, res, next) => { req.user = who ? { id: who, username: 'u' } : null; res.locals.user = req.user; req.isAuthenticated = () => Boolean(who); next(); });
  app.use(require('../web/middleware/platformQueue'));
  app.use('/communities', require('../web/routes/communities'));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use('/platform', require('../web/routes/platform'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  await test('pages: the catalog with filters, the community page with reviews, the owner page with answers, the platform page', async () => {
    for (const u of ['/communities', '/communities?tag=pvp&size=l&min=4&sort=rating', '/communities?fav=1', `/communities/${c2.id}`]) {
      const r = await fetch(base + u); const t = await r.text();
      assert(r.status === 200, u + ' ' + r.status + ' ' + t.slice(0, 300));
    }
    let r = await post(`/communities/${c2.id}/review`, { rating: '4', text: 'Хорошее сообщество, весело' });
    assert(r.status === 302 && /reviewed=1#reviews$/.test(r.headers.get('location')), r.headers.get('location'));
    r = await post(`/communities/${c2.id}/review`, { rating: '9' });
    assert(/err=/.test(r.headers.get('location')), 'error back');
    const page = await (await fetch(`${base}/communities/${c2.id}`)).text();
    ['Хорошее сообщество', 'cm-starpick', 'Изменить отзыв', 'Похожие сообщества', 'в сети', 'data-share'].forEach((s) => assert(page.includes(s), 'no ' + s));
    // a kept picture is served as WebP with a long cache; anything else is 404
    const shot = (await cm.one(c3.id)).galleryList[0];
    let pic = await fetch(base + shot);
    assert(pic.status === 200 && pic.headers.get('content-type') === 'image/webp' && /immutable/.test(pic.headers.get('cache-control')) && media.kindOf(Buffer.from(await pic.arrayBuffer())) === 'webp', 'served');
    assert((await fetch(`${base}/communities/media/${G3}/${'b'.repeat(20)}.webp`)).status === 404, 'missing → 404');
    assert((await fetch(`${base}/communities/media/${G3}/..%2F..%2Fx.webp`)).status === 404, 'no path tricks');
    const show3 = await (await fetch(`${base}/communities/${c3.id}`)).text();
    assert(show3.includes(`src="${shot}"`) && show3.includes("background-image:url('/communities/media/"), 'page shows kept pictures');
    r = await post(`/communities/${c2.id}/favorite`, { from: '/communities?sort=new' });
    assert(r.headers.get('location') === '/communities?sort=new', 'back to the list');
    r = await post(`/communities/${c2.id}/favorite`, { from: 'https://evil.com' });
    assert(/unfaved=1/.test(r.headers.get('location')), 'no open redirect: ' + r.headers.get('location'));
    const rv = await db.CommunityReview.findOne({ where: { communityId: c2.id } });
    who = ADMIN;
    const up = await fetch(`${base}/dashboard/${G2}/community/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: png(200, 100) });
    const upj = await up.json();
    assert(up.status === 200 && media.isLocal(upj.url) && upj.url.startsWith(`/communities/media/${G2}/`), JSON.stringify(upj));
    const bad = await fetch(`${base}/dashboard/${G2}/community/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('not a picture, just text here') });
    assert(bad.status === 400 && /не картинка/.test((await bad.json()).error), 'not a picture');
    r = await post(`/dashboard/${G2}/community/review/${rv.id}/reply`, { reply: 'Рады, что нравится!' });
    assert(/done=replied/.test(r.headers.get('location')) && (await rv.reload()).reply === 'Рады, что нравится!', 'reply');
    const own = await (await fetch(`${base}/dashboard/${G2}/community`)).text();
    ['Статистика по дням', 'class="sc-svg"', 'Рады, что нравится!', 'Куда присылать новые отзывы', 'linkUrl', 'data-cm-upload="shots"', 'data-cm-upload="banner"'].forEach((s) => assert(own.includes(s), 'owner page: no ' + s));
    who = U3;
    await post(`/communities/${c2.id}/review/${rv.id}/report`, { reason: 'Подозрительный отзыв' });
    who = OWNER;
    const pf = await (await fetch(`${base}/platform`)).text();
    assert(pf.includes('Отзывы с жалобами') && pf.includes('Подозрительный отзыв'), 'platform sees it');
    r = await post(`/platform/reviews/${rv.id}`, { action: 'hide' });
    assert(/done=review/.test(r.headers.get('location')) && (await rv.reload()).status === 'hidden', 'hidden by the platform');
  });
  await test('a community sent for checking: the owners of the platform are told and find it; its admins preview it', async () => {
    const dms = [];
    const users = { fetch: async (id) => ({ id, send: async (m) => { dms.push({ id, m }); } }) };
    require('../web/botBridge').setClient({ guilds: { cache: guilds }, users, isReady: () => true });
    await cm.setPlatform(OWNER, { premoderation: true });
    const G4 = '800000000000000004'; guilds.set(G4, guild(G4, 5));
    await cm.save(G4, ADMIN, form(4));
    await new Promise((r) => setTimeout(r, 30));
    const c4 = await db.Community.findOne({ where: { guildId: G4 } });
    assert(c4.status === 'pending', c4.status);
    const dm = dms.find((d) => d.id === OWNER);
    assert(dm && /ждёт проверки/.test(dm.m.embeds[0].data.title) && /platform#moderation$/.test(dm.m.embeds[0].data.url), 'owner DM: ' + JSON.stringify(dms));
    assert((await cm.queue()).pending === 1, 'queue');
    // the platform owner: a link with the count in the menu, the queue at the top of /platform, the page opens
    who = OWNER;
    const list = await (await fetch(`${base}/communities`)).text();
    assert(/href="\/platform#moderation"[^>]*>Платформа DARK <span class="pf-badge"/.test(list), 'link with the badge');
    const pf = await (await fetch(`${base}/platform`)).text();
    assert(pf.indexOf('id="moderation"') > 0 && pf.indexOf('id="moderation"') < pf.indexOf('DARK Coins</h2>') && pf.includes('Ждут проверки') && pf.includes(`/communities/${c4.id}`), 'queue on top');
    let pg = await fetch(`${base}/communities/${c4.id}`);
    let t = await pg.text();
    assert(pg.status === 200 && t.includes('Предпросмотр:') && t.includes('action="/platform/moderate"'), 'owner sees the waiting page ' + pg.status);
    // its admin sees a preview without the decision; a stranger gets 404
    who = ADMIN;
    t = await (await fetch(`${base}/communities/${c4.id}`)).text();
    assert(t.includes('Предпросмотр:') && !t.includes('action="/platform/moderate"'), 'admin preview');
    assert(!(await (await fetch(`${base}/communities`)).text()).includes('Платформа DARK'), 'no link for others');
    const own = await (await fetch(`${base}/dashboard/${G4}/community`)).text();
    assert(own.includes('отправлена на проверку') && own.includes('Предпросмотр страницы'), 'owner page explains');
    who = U1;
    assert((await fetch(`${base}/communities/${c4.id}`)).status === 404, 'stranger 404');
    // the decision: published, the sender is told
    who = OWNER;
    const r = await post('/platform/moderate', { id: String(c4.id), status: 'published', note: 'Добро пожаловать' });
    assert(/done=moderated/.test(r.headers.get('location')), r.headers.get('location'));
    await new Promise((res) => setTimeout(res, 30));
    const told = dms.find((d) => d.id === ADMIN);
    assert(told && /опубликовано/.test(told.m.embeds[0].data.title) && /Добро пожаловать/.test(told.m.embeds[0].data.description), 'sender DM');
    assert((await cm.queue()).pending === 0, 'queue empty');
    await cm.setPlatform(OWNER, { premoderation: false });
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
