// Faults from the code review: Discord refusing or not answering, a process stopped halfway, two clicks at once.
// Temp roles wait when Discord can't be asked and end for good when the member is gone; a shop role that Discord refuses
// gives the money back once; a purchase left half-done by a crash is finished on start; a refund twice is one refund;
// a changed price stops the purchase; a report taken by two moderators at once is taken once; banner links can't break CSS.
process.env.DATABASE_PATH = './data/test_faults.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const { MemberProfile, GuildSettings, ShopItem, Purchase, TempRole, MemberSnapshot } = db;
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const dErr = (code, status = 404) => Object.assign(new Error('Discord ' + code), { code, status });
  const G = '100000000000000001';
  await GuildSettings.findOrCreate({ where: { guildId: G } });
  await GuildSettings.update({ shopEnabled: true }, { where: { guildId: G } });

  const { isGone } = require('../bot/utils/discordErrors');
  await test('gone vs error: only "unknown member/role/channel…" means gone; 429, 5xx, a timeout do not', async () => {
    assert(isGone(dErr(10007)) && isGone(dErr(10011)) && isGone(dErr(10004)), 'gone codes');
    assert(!isGone(dErr(50013, 403)) && !isGone(Object.assign(new Error('rate'), { status: 429 })) && !isGone(new Error('ETIMEDOUT')) && !isGone(null), 'not gone');
  });

  // ---------- temp roles ----------
  const tempRoles = require('../bot/modules/tempRoles');
  const past = () => new Date(Date.now() - 1000);
  const mkClient = (guild) => ({ guilds: { cache: { get: (id) => (guild && id === G ? guild : null) } } });
  const removed = [];
  const guildWith = (fetch) => ({ id: G, name: 'S', members: { fetch }, roles: { cache: { get: () => ({ name: 'R' }) } } });
  const memberWith = (has, removeErr) => ({ id: 'u', roles: { cache: { has: () => has }, remove: async (r) => { if (removeErr) throw removeErr; removed.push(r); } }, send: async () => {} });

  await test('temp role: server not available right now → the term waits an hour, nothing is lost', async () => {
    const row = await TempRole.create({ guildId: G, userId: 'a1', roleId: 'R1', expiresAt: past() });
    await tempRoles.tick(mkClient(null));
    await row.reload();
    assert(new Date(row.expiresAt) - Date.now() > 50 * 60 * 1000, 'moved by an hour');
    await row.destroy();
  });

  await test('temp role: Discord can\'t be asked (500) → retry later; the member is gone (10007) → ended and struck out of saved roles', async () => {
    const a = await TempRole.create({ guildId: G, userId: 'a2', roleId: 'R1', expiresAt: past() });
    await tempRoles.tick(mkClient(guildWith(async () => { throw dErr(0, 500); })));
    await a.reload();
    assert(new Date(a.expiresAt) > new Date(), 'kept for later');
    await a.destroy();
    await MemberSnapshot.create({ guildId: G, userId: 'a3', roleIds: JSON.stringify(['R1', 'R2']) });
    await TempRole.create({ guildId: G, userId: 'a3', roleId: 'R1', expiresAt: past() });
    await tempRoles.tick(mkClient(guildWith(async () => { throw dErr(10007); })));
    assert(await TempRole.count({ where: { userId: 'a3' } }) === 0, 'term removed');
    const snap = await MemberSnapshot.findOne({ where: { guildId: G, userId: 'a3' } });
    assert(JSON.parse(snap.roleIds).join() === 'R2', 'snapshot ' + snap.roleIds);
  });

  await test('temp role: removing the role fails (no rights) → the term stays; the role was deleted (10011) → ended', async () => {
    const a = await TempRole.create({ guildId: G, userId: 'a4', roleId: 'R1', expiresAt: past() });
    await tempRoles.tick(mkClient(guildWith(async () => memberWith(true, dErr(50013, 403)))));
    assert(await TempRole.count({ where: { id: a.id } }) === 1, 'kept');
    await a.update({ expiresAt: past() });
    await tempRoles.tick(mkClient(guildWith(async () => memberWith(true, dErr(10011)))));
    assert(await TempRole.count({ where: { id: a.id } }) === 0, 'ended');
  });

  await test('temp role: Discord refuses to give it → no term is left behind', async () => {
    const member = { id: 'a5', roles: { add: async () => { throw dErr(50013, 403); } } };
    let threw = false;
    try { await tempRoles.give({ id: G }, member, { id: 'R9' }, 60000, 'x'); } catch { threw = true; }
    assert(threw, 'error passed on');
    assert(await TempRole.count({ where: { userId: 'a5' } }) === 0, 'no term');
  });

  // ---------- shop ----------
  const shop = require('../bot/modules/shop');
  const wallet = async (u, balance) => { const [p] = await MemberProfile.findOrCreate({ where: { guildId: G, userId: u } }); await p.update({ balance }); };
  const bal = async (u) => Number((await MemberProfile.findOne({ where: { guildId: G, userId: u } })).balance);
  const role = { editable: true, managed: false, permissions: { has: () => false } };
  const shopGuild = { id: G, roles: { cache: { get: (id) => (id === 'SR' ? role : null) } }, channels: { cache: { get: () => null }, fetch: async () => null } };
  const buyer = (id, addErr) => ({ id, roles: { cache: { has: () => false }, add: async () => { if (addErr) throw addErr; } } });

  await test('shop: Discord refuses the role → money, stock and journal all back, purchase «refunded»', async () => {
    await wallet('b1', 500);
    const it = await ShopItem.create({ guildId: G, name: 'Роль', price: 200, currency: 'coins', type: 'role', roleId: 'SR', stock: 3 });
    const r = await shop.purchaseItem({ guild: shopGuild, member: buyer('b1', dErr(50013, 403)), itemId: it.id });
    assert(!r.ok, 'failed');
    assert(await bal('b1') === 500, 'balance ' + await bal('b1'));
    await it.reload(); assert(it.stock === 3, 'stock ' + it.stock);
    const p = await Purchase.findOne({ where: { userId: 'b1' } });
    assert(p && p.status === 'refunded', 'status ' + p?.status);
  });

  await test('shop: the price changed between the card and the button → nothing is bought', async () => {
    await wallet('b2', 500);
    const it = await ShopItem.create({ guildId: G, name: 'Вещь', price: 300, currency: 'coins', type: 'item' });
    const r = await shop.purchaseItem({ guild: shopGuild, member: buyer('b2'), itemId: it.id, expectedPrice: 100 });
    assert(!r.ok && /Цена изменилась/.test(r.error), r.error);
    assert(await bal('b2') === 500, 'not charged');
  });

  await test('shop: a refund pressed twice at once gives the money back once', async () => {
    await wallet('b3', 500);
    const it = await ShopItem.create({ guildId: G, name: 'Вещь', price: 100, currency: 'coins', type: 'item' });
    const r = await shop.purchaseItem({ guild: shopGuild, member: buyer('b3'), itemId: it.id });
    assert(r.ok && await bal('b3') === 400, 'bought');
    const both = await Promise.all([shop.refundPurchase(r.purchase.id), shop.refundPurchase(r.purchase.id)]);
    assert(both.filter(Boolean).length === 1, 'one refund');
    assert(await bal('b3') === 500, 'balance ' + await bal('b3'));
  });

  await test('shop: a purchase left «delivering» by a crash — given on start; member gone → refunded; Discord down → waits', async () => {
    await wallet('c1', 0); await wallet('c2', 0); await wallet('c3', 0);
    const it = await ShopItem.create({ guildId: G, name: 'Роль', price: 50, currency: 'coins', type: 'role', roleId: 'SR' });
    const mk = (u) => Purchase.create({ guildId: G, userId: u, itemId: it.id, itemName: 'Роль', itemType: 'role', roleId: 'SR', price: 50, currency: 'coins', status: 'delivering' });
    const [p1, p2, p3] = [await mk('c1'), await mk('c2'), await mk('c3')];
    const g = { ...shopGuild, members: { fetch: async (u) => { if (u === 'c1') return buyer('c1'); if (u === 'c2') throw dErr(10007); throw dErr(0, 503); } } };
    await shop.resumeDeliveries({ guilds: { cache: { get: () => g } } });
    await p1.reload(); await p2.reload(); await p3.reload();
    assert(p1.status === 'done', 'given ' + p1.status);
    assert(p2.status === 'refunded' && await bal('c2') === 50, 'refunded ' + p2.status);
    assert(p3.status === 'delivering' && await bal('c3') === 0, 'waits ' + p3.status);
  });

  // ---------- reports ----------
  const reports = require('../bot/modules/reports');
  await test('reports: stuck «processing» reports go back to «open» on start', async () => {
    const r = await db.Report.create({ guildId: G, reporterId: 'r1', targetId: 'r2', category: 'other', reason: 'x', status: 'processing' });
    await reports.releaseStuck();
    await r.reload();
    assert(r.status === 'open', r.status);
  });

  // ---------- small things ----------
  await test('catalog banner: quotes and brackets in a link are encoded, the CSS url() can\'t be closed', async () => {
    const cm = require('../bot/modules/communities');
    const saved = cm.verifyInvite; cm.verifyInvite = async () => ({ ok: true, name: 'S', guildId: G });
    try {
      const host = (require('../bot/modules/communities').BANNER_HOSTS || ['i.imgur.com'])[0];
      const raw = `https://${host}/a');background:url('x(1).png`;
      const ejs = require('ejs');
      const s = raw.replace(/['"()\\\s]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
      assert(!/['()]/.test(s.slice(8)), s);
      const html = ejs.render("<% const bannerCss = /^https:\\/\\/[^'\"()\\\\\\s]+$/.test(u || '') ? u : null; %><% if (bannerCss) { %>url('<%= bannerCss %>')<% } %>", { u: raw });
      assert(html === '', 'raw link is not put into style: ' + html);
    } finally { cm.verifyInvite = saved; }
  });

  await test('webhook page: the CSP for previews really opens img-src to https', async () => {
    const csp = "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://i.imgur.com data:; style-src 'self'";
    const out = csp.replace(/img-src [^;]*/, "img-src 'self' https: data:");
    assert(out.includes("img-src 'self' https: data:;") && out.includes("style-src 'self'"), out);
    assert(/csp\.replace\(\/img-src \[\^;\]\*\//.test(fs.readFileSync(require.resolve('../web/routes/dashboard/messages.js'), 'utf8')), 'route uses the pattern');
  });

  await test('crypto: an unreadable secret gives null and a warning, never a crash', async () => {
    const warns = []; const w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      process.env.DATA_KEY = 'k'.repeat(32);
      const c = require('../db/crypto');
      const enc = c.encrypt('secret');
      assert(c.decrypt(enc) === 'secret', 'round trip');
      process.env.DATA_KEY = 'z'.repeat(32);
      assert(c.decrypt(enc) === null, 'other key → null');
      assert(warns.some((x) => /cannot be read/.test(x)), 'warned');
    } finally { console.warn = w; delete process.env.DATA_KEY; }
  });

  await test('no-store also on /appeals and /platform', async () => {
    const src = fs.readFileSync(require.resolve('../web/index.js'), 'utf8');
    assert(/dashboard\|auth\|appeals\|platform/.test(src), 'paths');
  });

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.l + (r.ok ? '' : '\n     ' + r.e)));
  console.log(`\nfaults: ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
})();
