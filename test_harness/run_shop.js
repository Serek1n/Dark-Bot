// Shop: purchases, limits, roles, daily streak.
process.env.DATABASE_PATH = './data/test_shop.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { makeInteraction, makeGuild, makeUser } = require('./mock');

(async () => {
  const db = require('../db'); await db.init();
  const { MemberProfile, GuildSettings, ShopItem, Purchase } = db;
  const shop = require('../bot/modules/shop');
  const economy = require('../bot/commands/economy/economy');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = 'g1';
  await GuildSettings.findOrCreate({ where: { guildId: G } });
  const wallet = async (u, balance, crystals = 0, level = 1) => {
    const [p] = await MemberProfile.findOrCreate({ where: { guildId: G, userId: u } });
    await p.update({ balance, crystals, level }); return p;
  };
  const reload = (u) => MemberProfile.findOne({ where: { guildId: G, userId: u } });
  const roleAdds = [];
  const mkGuild = (roles) => ({ id: G, roles: { cache: { get: (id) => roles[id] } }, channels: { cache: { get: () => null }, fetch: async () => null } });
  const mkMember = (id, has = [], failAdd = false) => ({ id, roles: { cache: { has: (r) => has.includes(r) }, add: async (r) => { if (failAdd) throw new Error('403'); roleAdds.push([id, r]); } } });
  const okRole = { editable: true, managed: false };
  const guild = mkGuild({ R1: okRole, RB: { editable: false, managed: false } });
  const mk = (f) => ShopItem.create({ guildId: G, name: 'X', price: 100, currency: 'coins', type: 'item', ...f });

  await test('buy item: pays, stock down, pending without message, done with message', async () => {
    await wallet('u1', 250);
    const a = await mk({ stock: 2 }); const b = await mk({ deliveryMessage: 'key' });
    let r = await shop.purchaseItem({ guild, member: mkMember('u1'), itemId: a.id });
    assert(r.ok && r.purchase.status === 'pending', 'pending');
    r = await shop.purchaseItem({ guild, member: mkMember('u1'), itemId: b.id });
    assert(r.ok && r.purchase.status === 'done', 'done');
    assert((await reload('u1')).balance === 50, 'balance'); assert((await a.reload()).stock === 1, 'stock');
    assert(JSON.stringify(shop.purchaseReceipt(r).toJSON()).includes('key'), 'receipt has the message');
  });
  await test('not enough money / level / crystals', async () => {
    await wallet('u2', 50, 5, 1);
    const i = await mk({ price: 100 }); const lv = await mk({ price: 1, minLevel: 5 }); const cr = await mk({ price: 10, currency: 'crystals' });
    for (const [it, word] of [[i, 'Не хватает'], [lv, 'уровня'], [cr, 'Не хватает']]) {
      const r = await shop.purchaseItem({ guild, member: mkMember('u2'), itemId: it.id });
      assert(!r.ok && r.error.includes(word), it.id + ' ' + JSON.stringify(r));
    }
    assert((await reload('u2')).balance === 50, 'nothing charged');
    await wallet('u2', 50, 20, 1);
    assert((await shop.purchaseItem({ guild, member: mkMember('u2'), itemId: cr.id })).ok, 'crystals ok');
    assert((await reload('u2')).crystals === 10, 'crystals spent');
  });
  await test('last piece: two buyers at once, only one wins and nobody pays twice', async () => {
    await wallet('a', 100); await wallet('b', 100);
    const it = await mk({ stock: 1 });
    const rs = await Promise.all([shop.purchaseItem({ guild, member: mkMember('a'), itemId: it.id }), shop.purchaseItem({ guild, member: mkMember('b'), itemId: it.id })]);
    assert(rs.filter((r) => r.ok).length === 1, 'one winner'); assert((await it.reload()).stock === 0, 'stock 0');
    assert((await reload('a')).balance + (await reload('b')).balance === 100, 'only one paid');
  });
  await test('same person double-clicking cannot overspend', async () => {
    await wallet('d', 100); const it = await mk({});
    const rs = await Promise.all([1, 2, 3].map(() => shop.purchaseItem({ guild, member: mkMember('d'), itemId: it.id })));
    assert(rs.filter((r) => r.ok).length === 1 && (await reload('d')).balance === 0, 'one purchase');
  });
  await test('role items: success, already owned, bot cannot give, API failure keeps money', async () => {
    await wallet('r', 300);
    const it = await mk({ type: 'role', roleId: 'R1' });
    let r = await shop.purchaseItem({ guild, member: mkMember('r'), itemId: it.id });
    assert(r.ok && r.purchase.status === 'done' && roleAdds.some((x) => x[1] === 'R1'), 'given');
    r = await shop.purchaseItem({ guild, member: mkMember('r', ['R1']), itemId: it.id });
    assert(!r.ok && r.error.includes('уже есть'), 'owned');
    const hi = await mk({ type: 'role', roleId: 'RB' });
    r = await shop.purchaseItem({ guild, member: mkMember('r'), itemId: hi.id });
    assert(!r.ok && r.error.includes('роль бота'), 'hierarchy');
    const gone = await mk({ type: 'role', roleId: 'NOPE' });
    r = await shop.purchaseItem({ guild, member: mkMember('r'), itemId: gone.id });
    assert(!r.ok && r.error.includes('удалена'), 'deleted role');
    r = await shop.purchaseItem({ guild, member: mkMember('r', [], true), itemId: it.id });
    assert(!r.ok, 'api failure'); assert((await reload('r')).balance === 200, 'only the first purchase was charged');
  });
  await test('role for a while: given with a term, bought again = prolonged from the end, a role held for good is refused', async () => {
    const { TempRole } = db;
    await wallet('t', 1000);
    const it = await mk({ type: 'role', roleId: 'R1', durationSeconds: 10 * 86400 });
    const t0 = Date.now();
    let r = await shop.purchaseItem({ guild, member: mkMember('t'), itemId: it.id });
    assert(r.ok && !r.extended, 'bought ' + r.error);
    const row = await TempRole.findOne({ where: { guildId: G, userId: 't', roleId: 'R1' } });
    const end1 = new Date(row.expiresAt).getTime();
    assert(Math.abs(end1 - (t0 + 10 * 86400e3)) < 5000, 'term 10 days');
    assert(r.purchase.expiresAt && Math.abs(new Date(r.purchase.expiresAt).getTime() - end1) < 5, 'purchase keeps the end');
    const receipt = JSON.stringify(shop.purchaseReceipt(r).toJSON());
    assert(receipt.includes('выдана до <t:') && receipt.includes('снимется сама'), receipt);
    r = await shop.purchaseItem({ guild, member: mkMember('t', ['R1']), itemId: it.id });
    assert(r.ok && r.extended, 'prolonged ' + r.error);
    await row.reload(); assert(Math.abs(new Date(row.expiresAt).getTime() - (end1 + 10 * 86400e3)) < 5, 'from the old end');
    assert(JSON.stringify(shop.purchaseReceipt(r).toJSON()).includes('продлена до'), 'receipt says prolonged');
    assert((await reload('t')).balance === 1000 - 200, 'paid twice');
    const forever = await mk({ type: 'role', roleId: 'R1' });
    await wallet('p', 1000);
    r = await shop.purchaseItem({ guild, member: mkMember('p', ['R1']), itemId: it.id });
    assert(!r.ok && r.error.includes('уже есть'), 'held for good: not sold on a term');
    r = await shop.purchaseItem({ guild, member: mkMember('t', ['R1']), itemId: forever.id });
    assert(!r.ok && r.error.includes('уже есть'), 'the permanent item is not sold to a holder either');
    r = await shop.purchaseItem({ guild, member: mkMember('f', [], true), itemId: it.id });
    assert(!r.ok && !(await TempRole.findOne({ where: { guildId: G, userId: 'f' } })), 'Discord refused: no term stored');
  });

  await test('the term ends: the role is taken away; a term prolonged meanwhile is kept', async () => {
    const { TempRole } = db;
    const tr = require('../bot/modules/tempRoles');
    const removed = [];
    const member = { roles: { cache: { has: () => true }, remove: async (id) => removed.push(id) } };
    const client = { guilds: { cache: new Map([[G, { members: { fetch: async () => member } }]]) } };
    await TempRole.create({ guildId: G, userId: 'e1', roleId: 'R1', expiresAt: new Date(Date.now() - 1000), givenBy: 'shop:1' });
    await tr.tick(client);
    assert(removed.length === 1 && !(await TempRole.findOne({ where: { userId: 'e1' } })), 'taken away');
    const due = await TempRole.create({ guildId: G, userId: 'e2', roleId: 'R1', expiresAt: new Date(Date.now() - 1000) });
    // the list of due rows is read, then someone prolongs the term before the role is taken away (reload goes to the real findAll)
    const realFindAll = TempRole.findAll; let first = true;
    TempRole.findAll = async function (...a) { if (!first) return realFindAll.apply(this, a); first = false; await TempRole.update({ expiresAt: new Date(Date.now() + 86400e3) }, { where: { id: due.id } }); return [due]; };
    try { await tr.tick(client); } finally { TempRole.findAll = realFindAll; }
    assert(removed.length === 1 && (await TempRole.findByPk(due.id)), 'prolonged role stays');
  });

  await test('panel: the term field reads 10д / 12 ч / 1мес, empty = forever, nonsense and too long are refused', async () => {
    const { termSeconds } = require('../web/routes/dashboard/shop');
    assert(termSeconds('') === null && termSeconds('  ') === null, 'empty');
    assert(termSeconds('10д') === 864000 && termSeconds('12 ч') === 43200 && termSeconds('1мес') === 30 * 86400, 'units');
    assert(termSeconds('abc') === undefined && termSeconds('2 года') === undefined && termSeconds('10s') === undefined, 'refused');
    const { formatTerm, parseDuration } = require('../bot/utils/duration');
    assert(formatTerm(864000e3) === '10 д' && formatTerm(36 * 3600e3) === '36 ч' && formatTerm(90 * 60e3) === '90 мин', 'shown back');
    [864000e3, 36 * 3600e3, 90 * 60e3].forEach((ms) => assert(parseDuration(formatTerm(ms)) === ms, 'round trip ' + ms));
    const ejs = require('ejs'); const path = require('path');
    const html = await ejs.renderFile(path.join(__dirname, '..', 'web/views/partials/shop-fields.ejs'), { it: { name: 'VPN', price: 5000, currency: 'coins', type: 'role', roleId: 'R1', durationSeconds: 864000, stock: null, minLevel: 0, deliveryMessage: '', enabled: true }, roles: [], settings: { currencyName: 'монеты', crystalName: 'кристаллы' }, termText: formatTerm });
    assert(html.includes('name="duration" value="10 д"') && html.includes('Срок действия роли'), 'form field');
    const line = JSON.stringify((await shop.buildShopPanel({ id: G }, 'x')));
    assert(line.includes('на 10 д'), 'the shop list shows the term');
  });

  await test('disabled item, other server item, and shop switched off', async () => {
    await wallet('s', 500);
    const off = await mk({ enabled: false }); const other = await ShopItem.create({ guildId: 'g2', name: 'O', price: 1 });
    assert(!(await shop.purchaseItem({ guild, member: mkMember('s'), itemId: off.id })).ok, 'disabled');
    assert(!(await shop.purchaseItem({ guild, member: mkMember('s'), itemId: other.id })).ok, 'foreign');
    const st = await GuildSettings.findOne({ where: { guildId: G } }); await st.update({ shopEnabled: false });
    const it = await mk({}); assert(!(await shop.purchaseItem({ guild, member: mkMember('s'), itemId: it.id })).ok, 'off');
    assert((await shop.buildShopPanel(guild, 's')).error, 'panel says off');
    await st.update({ shopEnabled: true });
    assert((await reload('s')).balance === 500, 'untouched');
  });
  await test('/shop panel and buttons: owner-only, confirm, cancel, history', async () => {
    await ShopItem.destroy({ where: { guildId: G } }); await Purchase.destroy({ where: { guildId: G } });
    await wallet('p', 300); const it = await mk({ name: 'Cake', price: 120 });
    const cmd = require('../bot/commands/economy/shop');
    const i = makeInteraction({ user: { id: 'p' } }); i.guild = guild; await cmd.execute(i);
    const panel = JSON.stringify(i._replies);
    assert(panel.includes('Cake') && panel.includes('shop:pick:p') && panel.includes('shop:mine:p'), 'panel ' + panel.slice(0, 200));
    assert(shop.isShopComponent({ customId: 'shop:pick:p', isButton: () => false, isStringSelectMenu: () => true }), 'routing');
    const reply = [];
    const comp = (customId, extra = {}) => ({ customId, user: { id: 'p' }, guild, member: mkMember('p'), values: [String(it.id)], replied: false, deferred: false,
      reply: async (x) => reply.push(['reply', JSON.stringify(x)]), update: async (x) => reply.push(['update', JSON.stringify(x)]), editReply: async (x) => reply.push(['edit', JSON.stringify(x)]), ...extra });
    await shop.handleShopComponent(comp('shop:pick:p'));
    assert(reply.at(-1)[1].includes(`shop:buy:${it.id}:p`), 'confirm shown');
    await shop.handleShopComponent(comp('shop:pick:other', { user: { id: 'p' } }));
    await shop.handleShopComponent(comp(`shop:buy:${it.id}:zzz`));
    assert(reply.at(-1)[1].includes('другого участника'), 'foreign owner blocked'); assert((await reload('p')).balance === 300, 'not charged');
    await shop.handleShopComponent(comp('shop:cancel:p')); assert(reply.at(-1)[1].includes('отменена'), 'cancel');
    await shop.handleShopComponent(comp(`shop:buy:${it.id}:p`));
    assert(reply.at(-1)[1].includes('Покупка совершена') && (await reload('p')).balance === 180, 'bought');
    await shop.handleShopComponent(comp('shop:mine:p')); assert(reply.at(-1)[1].includes('Cake'), 'history');
  });
  await test('daily streak grows, caps, and resets after a missed day', async () => {
    const st = await GuildSettings.findOne({ where: { guildId: G } }); await st.update({ dailyCoins: 100, dailyStreakBonus: 10, dailyStreakMax: 3 });
    await wallet('dd', 0);
    const run = async () => { const i = makeInteraction({ guild: makeGuild({ id: G }), subcommand: 'daily', user: makeUser('dd') }); await economy.execute(i); return JSON.stringify(i._replies); };
    const shift = async (ms) => { const p = await reload('dd'); await p.update({ lastDailyAt: new Date(Date.now() - ms) }); };
    await run(); let p = await reload('dd'); assert(p.balance === 100 && p.dailyStreak === 1, 'day1 ' + p.balance);
    await shift(25 * 3600e3); await run(); p = await reload('dd'); assert(p.balance === 210 && p.dailyStreak === 2, 'day2 ' + p.balance);
    await shift(25 * 3600e3); await run(); await shift(25 * 3600e3); await run(); p = await reload('dd');
    assert(p.dailyStreak === 4 && p.balance === 210 + 120 + 120, 'cap ' + p.balance + ' ' + p.dailyStreak);
    await shift(60 * 3600e3); await run(); p = await reload('dd'); assert(p.dailyStreak === 1, 'reset');
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
