// Communities and DARK Coins: coins change only by platform owners or a purchase, every change journaled, the same operation
// never twice, never below zero (also at the same moment); listings checked; catalog search / categories / sort / pinned
// first; votes limited; promotion paid once, active at once, extended, ending by itself; the public, owner and platform pages.
process.env.DATABASE_PATH = './data/test_communities.sqlite';
process.env.BOT_OWNER_IDS = '700000000000000001';
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'Сервер', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'U' + String(id).slice(-2), avatar: '' }])), botApi: {} });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const coins = require('../bot/modules/darkCoins');
  const cm = require('../bot/modules/communities');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const fails = async (f, re) => { try { await f(); } catch (e) { assert(re.test(e.message), e.message); return; } throw new Error('did not fail'); };
  const OWNER = '700000000000000001'; const ADMIN = '700000000000000002'; const BUYER = '300000000000000003';
  const form = (n, extra = {}) => ({ name: 'Сервер ' + n, shortDesc: 'Дружное сообщество номер ' + n, description: 'Подробно', categories: ['gaming'], tags: 'minecraft, ивенты', inviteUrl: 'https://discord.gg/abc' + n, ...extra });

  await test('DARK Coins: only a platform owner gives or takes; a server admin can\'t; amounts checked', async () => {
    await fails(() => coins.grant({ actorId: ADMIN, userId: BUYER, amount: 100, opKey: 'k-admin-0001' }), /владелец платформы/);
    await fails(() => coins.grant({ actorId: OWNER, userId: BUYER, amount: 0, opKey: 'k-zero-00001' }), /от 1/);
    await fails(() => coins.grant({ actorId: OWNER, userId: 'abc', amount: 5, opKey: 'k-baduser-01' }), /ID/);
    const { tx } = await coins.grant({ actorId: OWNER, userId: BUYER, amount: 1000, note: 'тест', opKey: 'k-grant-0001' });
    assert(tx.amount === 1000 && Number(tx.balanceAfter) === 1000 && tx.actorId === OWNER && tx.kind === 'grant', JSON.stringify(tx));
    assert(await coins.balanceOf(BUYER) === 1000, 'balance');
  });

  await test('the same operation key twice (a repeated form) changes the balance once', async () => {
    const r = await Promise.all([coins.grant({ actorId: OWNER, userId: BUYER, amount: 50, opKey: 'k-twice-0001' }), coins.grant({ actorId: OWNER, userId: BUYER, amount: 50, opKey: 'k-twice-0001' })]);
    assert(r.filter((x) => x.duplicate).length === 1, 'one duplicate');
    assert(await coins.balanceOf(BUYER) === 1050, 'balance ' + await coins.balanceOf(BUYER));
    assert(await db.DarkCoinTx.count({ where: { userId: BUYER } }) === 2, 'two journal lines');
  });

  await test('never below zero: taking more fails; ten charges at once spend only what there is', async () => {
    await fails(() => coins.revoke({ actorId: OWNER, userId: BUYER, amount: 5000, opKey: 'k-revoke-big' }), /Недостаточно/);
    const U = '300000000000000004';
    await coins.grant({ actorId: OWNER, userId: U, amount: 300, opKey: 'k-u4-grant01' });
    const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => db.inTransaction((t) => coins.charge(U, 100, { kind: 'promo', opKey: `k-u4-charge-${i}` }, t))));
    assert(r.filter((x) => x.status === 'fulfilled').length === 3, r.map((x) => x.status).join());
    assert(await coins.balanceOf(U) === 0, 'zero, not negative');
  });

  // Discord is asked about an invite; here it answers that every invite «abc…» leads to the server it is saved for
  cm.verifyInvite = async (url, guildId) => { if (/other/i.test(url)) throw new cm.CommunityError('Приглашение ведёт на другой сервер.'); void guildId; return { name: null }; };
  let c1;
  await test('listing: invite, banner host, categories and texts are checked; a new one is published (or waits with pre-moderation)', async () => {
    await fails(() => cm.save('800000000000000001', ADMIN, form(1, { inviteUrl: 'https://evil.com/x' })), /discord\.gg/);
    await fails(() => cm.save('800000000000000001', ADMIN, form(1, { bannerUrl: 'https://evil.com/b.png' })), /Баннер/);
    await fails(() => cm.save('800000000000000001', ADMIN, form(1, { categories: [] })), /категорию/);
    await fails(() => cm.save('800000000000000001', ADMIN, form(1, { shortDesc: 'коротко' })), /10 символов/);
    assert((await cm.platform()).premoderation === true, 'pre-moderation is on until the owner switches it off');
    await fails(() => cm.save('800000000000000001', ADMIN, form(1, { inviteUrl: 'https://discord.gg/other1' })), /другой сервер/);
    await cm.setPlatform(OWNER, { premoderation: false });
    c1 = await cm.save('800000000000000001', ADMIN, form(1, { inviteUrl: 'discord.com/invite/Abc-1', categories: ['gaming', 'music', 'art', 'tech'] }));
    assert(c1.status === 'published' && c1.inviteUrl === 'https://discord.gg/Abc-1' && c1.categories === 'gaming,music,art', JSON.stringify(c1));
    await fails(() => cm.setPlatform(ADMIN, { premoderation: true }), /владелец/);
    await cm.setPlatform(OWNER, { premoderation: true, prices: { pin: 40 } });
    const c2 = await cm.save('800000000000000002', ADMIN, form(2, { categories: ['music'] }));
    assert(c2.status === 'pending', 'pre-moderated');
    await cm.moderate(OWNER, c2.id, 'published');
    await cm.setPlatform(OWNER, { premoderation: false });
    await cm.save('800000000000000003', ADMIN, form(3, { categories: ['music'], tags: 'рок' }));
  });

  await test('catalog: search, category, sorting by votes; page size; a blocked or hidden one is not shown', async () => {
    let r = await cm.catalog({ category: 'music' });
    assert(r.total === 3, 'music ' + r.total); // c1 has music too
    r = await cm.catalog({ q: 'рок' });
    assert(r.total === 1 && r.items[0].name === 'Сервер 3', 'search');
    const c4 = await cm.save('800000000000000004', ADMIN, form(4));
    await cm.moderate(OWNER, c4.id, 'blocked', 'спам');
    await fails(() => cm.save('800000000000000004', ADMIN, form(4)), /заблокировано/i);
    await cm.setVisible('800000000000000003', false);
    r = await cm.catalog({});
    assert(r.total === 2 && !r.items.some((c) => ['Сервер 3', 'Сервер 4'].includes(c.name)), r.items.map((c) => c.name).join());
    await cm.setVisible('800000000000000003', true);
  });

  await test('votes: new accounts can\'t vote; once in 12 hours per account; a network is limited; views counted once an hour', async () => {
    await fails(() => cm.vote(c1.id, String((BigInt(Date.now() - 1420070400000) << 22n)), '1.1.1.1'), /старше 7 дней/);
    await cm.vote(c1.id, BUYER, '1.1.1.1');
    await fails(() => cm.vote(c1.id, BUYER, '1.1.1.1'), /уже голосовали/);
    for (let i = 0; i < 9; i++) await cm.vote(c1.id, `30000000000000010${i}`, '2.2.2.2');
    await cm.vote(c1.id, '300000000000000200', '2.2.2.2');
    await fails(() => cm.vote(c1.id, '300000000000000201', '2.2.2.2'), /сети/);
    const row = await db.Community.findByPk(c1.id);
    assert(row.votes === 11, 'votes ' + row.votes);
    assert(await cm.view(c1.id, 'v1') === true && await cm.view(c1.id, 'v1') === false, 'view once');
    const r = await cm.catalog({ sort: 'votes' });
    assert(r.items[0].id === c1.id, 'most votes first');
  });

  await test('promotion: refused without coins; paid once per form; pin goes on top at once, extends, ends by itself', async () => {
    const c2 = await db.Community.findOne({ where: { guildId: '800000000000000002' } });
    await fails(() => cm.buy('800000000000000002', '300000000000000009', 'pin', 1, 'formkey0001'), /Недостаточно/);
    const before = await coins.balanceOf(BUYER);
    const [a, b] = await Promise.all([cm.buy('800000000000000002', BUYER, 'pin', 3, 'formkey0002'), cm.buy('800000000000000002', BUYER, 'pin', 3, 'formkey0002')]);
    assert([a, b].filter((x) => x.duplicate).length === 1, 'one duplicate');
    assert(await coins.balanceOf(BUYER) === before - 120, `charged once: ${before} → ${await coins.balanceOf(BUYER)}`);
    assert(await db.CommunityPromotion.count({ where: { communityId: c2.id } }) === 1, 'one promotion');
    let r = await cm.catalog({ sort: 'votes' });
    assert(r.items[0].id === c2.id && r.items[0].pinned, 'pinned first');
    const second = await cm.buy('800000000000000002', BUYER, 'pin', 1, 'formkey0003');
    const first = await db.CommunityPromotion.findOne({ where: { communityId: c2.id }, order: [['id', 'ASC']] });
    assert(new Date(second.promotion.startsAt).getTime() === new Date(first.endsAt).getTime(), 'extended after the current one');
    await db.CommunityPromotion.update({ endsAt: new Date(Date.now() - 1000) }, { where: { communityId: c2.id } });
    r = await cm.catalog({ sort: 'votes' });
    assert(r.items[0].id === c1.id && !r.items.find((x) => x.id === c2.id).pinned, 'pin ended');
    const tx = await db.DarkCoinTx.findAll({ where: { userId: BUYER, kind: 'promo' } });
    assert(tx.length === 2 && tx.every((t) => t.amount < 0), 'journal of purchases');
    await cm.buy('800000000000000001', BUYER, 'featured', 1, 'formkey0004');
    r = await cm.catalog({});
    assert(r.featured.some((c) => c.id === c1.id), 'featured block');
    await fails(() => cm.buy('800000000000000001', BUYER, 'pin', 2, 'formkey0005'), /срок/);
  });

  await test('web: catalog, page, join counts a click, vote needs sign-in; platform only for owners; owner page saves and buys', async () => {
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use(express.urlencoded({ extended: true }));
    let who = null;
    app.use((req, res, next) => { req.user = who ? { id: who, username: 'u' } : undefined; req.isAuthenticated = () => Boolean(who); res.locals.user = req.user || null; next(); });
    require('../web/modules');
    app.use('/communities', require('../web/routes/communities'));
    app.use('/platform', require('../web/routes/platform'));
    app.use('/dashboard', require('../web/routes/dashboard/community'));
    app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p, b) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    try {
      let r = await fetch(base + '/communities?category=music&sort=new'); let t = await r.text();
      assert(r.status === 200 && t.includes('Сервер 2') && t.includes('Присоединиться'), 'catalog ' + r.status + t.slice(0, 500));
      t = await (await fetch(`${base}/communities/${c1.id}`)).text();
      assert(t.includes('Дружное сообщество номер 1') && t.includes('Голосовать'), 'page');
      const clicks = (await db.Community.findByPk(c1.id)).clicks;
      r = await fetch(`${base}/communities/${c1.id}/join`, { redirect: 'manual' });
      await cm.flushStats(); // counters are written in batches
      assert(r.status === 302 && r.headers.get('location') === 'https://discord.gg/Abc-1' && (await db.Community.findByPk(c1.id)).clicks === clicks + 1, 'join');
      r = await post(`/communities/${c1.id}/vote`, {});
      assert(r.headers.get('location').startsWith('/auth/login'), 'sign-in first');
      assert((await fetch(base + '/communities/99999')).status === 404, 'unknown');
      who = ADMIN;
      assert((await fetch(base + '/platform')).status === 404, 'platform hidden from others');
      r = await post('/platform/coins', { userId: BUYER, amount: '10', key: 'abcdefabcdef' });
      assert(r.status === 404, 'and its actions');
      who = OWNER;
      t = await (await fetch(base + '/platform?user=' + BUYER)).text();
      assert(t.includes('DARK Coins') && t.includes('Журнал'), 'platform page');
      const bal = await coins.balanceOf(BUYER);
      await post('/platform/coins', { userId: BUYER, amount: '25', op: 'grant', note: 'за ивент', key: 'abcdefabcdef01' });
      r = await post('/platform/coins', { userId: BUYER, amount: '25', op: 'grant', note: 'за ивент', key: 'abcdefabcdef01' });
      assert(r.headers.get('location').includes('done=dup') && await coins.balanceOf(BUYER) === bal + 25, 'resubmitted form: once');
      who = BUYER;
      t = await (await fetch(base + '/dashboard/800000000000000005/community')).text();
      assert(t.includes('Добавить в каталог') && t.includes('DARK Coins'), 'owner page');
      r = await post('/dashboard/800000000000000005/community', { ...form(5), categories: 'social' });
      assert(r.headers.get('location').includes('saved'), r.headers.get('location'));
      r = await post('/dashboard/800000000000000005/community/buy', { kind: 'highlight', days: '1', key: 'pagekey000001-highlight' });
      assert(r.headers.get('location').includes('bought'), r.headers.get('location'));
      t = await (await fetch(base + '/dashboard/800000000000000005/community')).text();
      assert(t.includes('Действует до') && t.includes('История покупок'), 'active promo shown');
      t = await (await fetch(base + '/communities')).text();
      assert(t.includes('cm-card hl'), 'highlighted card');
      r = await post('/dashboard/800000000000000005/community/delete', {});
      assert(!(await db.Community.findOne({ where: { guildId: '800000000000000005' } })), 'removed');
    } finally { server.close(); }
  });

  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : `\n   ${r.e}`}`);
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
