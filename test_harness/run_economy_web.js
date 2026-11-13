// Economy pages of the panel: the mode choice saves, tabs appear only for switched-on sections, every page renders, actions work.
process.env.DATABASE_PATH = './data/test_economy_web.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', {
  getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }],
  getGuildRoles: async () => [{ id: '223456789012345678', name: 'Role' }], getGuild: async (id) => ({ id, name: 'T', icon: null }),
  getUsers: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'n' + i, avatar: '' }])), botApi: { get: require('./ownerGuild').ownerGet('777000000000000001', ['223456789012345678']) }
});
const express = require('express');

(async () => {
  const db = require('../db'); await db.init();
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const G = '777000000000000001';
  const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.message }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); return { status: r.status, text: await r.text(), location: r.headers.get('location') }; };
  const S = () => db.GuildSettings.findOne({ where: { guildId: G } });
  const ledger = require('../bot/modules/econ/ledger');

  await test('simple mode: settings page renders, only the journal tab, section pages send back to settings', async () => {
    const r = await get('/economy');
    assert(r.status === 200, r.text.slice(0, 300));
    assert(r.text.includes('Как устроена экономика') && r.text.includes('name="mode" value="simple" checked'), 'mode block');
    assert(r.text.includes('/economy-journal"') && !r.text.includes('/economy-bank"'), 'tabs');
    assert((await get('/economy-bank')).status === 302, 'bank hidden');
    assert((await get('/economy-journal')).status === 200, 'journal always');
  });
  await test('detailed mode with sections and numbers saves; tabs appear; channel must be the server\'s', async () => {
    const r = await post('/economy', { currencyName: 'монет', crystalName: 'кристаллов', dailyCoins: '100', dailyStreakBonus: '10', dailyStreakMax: '7',
      mode: 'custom', f_bank: 'on', f_treasury: 'on', f_goals: 'on', f_deals: 'on', f_gifts: 'on', f_seasons: 'on', f_work: 'on', p_work_cooldownMin: '45',
      p_bank_autoRate__present: '1', eventsChannelId: '999999999999999999', eventsMode: 'each' });
    assert(r.status === 302, 'saved ' + r.status);
    const s = await S();
    assert(s.economyMode === 'custom' && JSON.parse(s.economyParams).work.cooldownMin === 45, 'params');
    assert(JSON.parse(s.economyParams).bank.autoRate === false, 'unchecked bool saved as off');
    assert(s.economyEventsChannelId === null && s.economyEventsMode === 'each', 'foreign channel refused');
    assert(s.seasonStartedAt, 'season started');
    const page = await get('/economy');
    for (const t of ['/economy-bank"', '/economy-treasury"', '/economy-deals"']) assert(page.text.includes(t), 'tab ' + t);
    await post('/economy', { currencyName: 'монет', crystalName: 'кристаллов', mode: 'custom', f_bank: 'on', f_treasury: 'on', f_goals: 'on', f_deals: 'on', f_gifts: 'on', f_seasons: 'on', f_work: 'on', eventsChannelId: '123456789012345678', eventsMode: 'summary' });
    assert((await S()).economyEventsChannelId === '123456789012345678', 'channel saved');
  });
  await test('preset mode: unticked sections keep their numbers', async () => {
    await post('/economy', { mode: 'preset', preset: 'calm', tune__present: '1', p_work_cooldownMin: '5' });
    const s = await S();
    assert(s.economyMode === 'preset' && JSON.parse(s.economyParams).work.cooldownMin === 45, 'kept');
    await post('/economy', { mode: 'preset', preset: 'calm', tune__present: '1', tune_work: 'on', p_work_cooldownMin: '90' });
    assert(JSON.parse((await S()).economyParams).work.cooldownMin === 90, 'tuned');
    await post('/economy', { mode: 'preset', preset: 'full', tune__present: '1' });
  });
  await test('every section page renders with data', async () => {
    await db.MemberProfile.create({ guildId: G, userId: '323456789012345678', balance: 500 });
    await db.MemberProfile.create({ guildId: G, userId: '423456789012345678', balance: 50 });
    await ledger.record({ guildId: G, userId: '323456789012345678', amount: 30, kind: 'work', note: 'Курьер' });
    await ledger.earnMany(G, ['323456789012345678', '423456789012345678'], 'chat', 'coins', 5);
    await ledger.treasuryAdd(G, 1000);
    await db.EconomySupply.create({ guildId: G, day: ledger.day(new Date(Date.now() - 86400000)), coins: 400, crystals: 0, holders: 2, rate: 1 });
    await db.EconomySupply.create({ guildId: G, day: ledger.day(), coins: 550, crystals: 0, holders: 2, rate: 1 });
    await db.EconomyGoal.create({ guildId: G, title: 'Буст', target: 2000, raised: 100, endsAt: new Date(Date.now() + 86400000), action: 'boost', boostMult: 2, boostHours: 24, status: 'open' });
    await db.EconomyDeal.create({ guildId: G, buyerId: '323456789012345678', sellerId: '423456789012345678', amount: 100, title: 'Аватар', status: 'disputed', expiresAt: new Date() });
    for (const p of ['/economy-bank', '/economy-treasury', '/economy-deals', '/economy-journal', '/economy-journal?kind=work&days=7&user=323456789012345678']) {
      const r = await get(p); assert(r.status === 200, `${p} -> ${r.status}: ${r.text.slice(0, 400)}`);
    }
    const bank = await get('/economy-bank');
    assert(bank.text.includes('Половина всех монет') && bank.text.includes('econ-chart'), 'bank content');
    const j = await get('/economy-journal?kind=work');
    assert(j.text.includes('Курьер') && j.text.includes('Работа'), 'journal row');
  });
  await test('bot events page: renders, saves order and switches, refuses a foreign channel, links back from economy', async () => {
    let r = await get('/events');
    assert(r.status === 200, r.text.slice(0, 300));
    assert(r.text.includes('Что присылает бот') && r.text.includes('Начать событие сейчас') && r.text.includes('Пример сообщения'), 'blocks');
    const save = await post('/events', { channelId: '123456789012345678', summary: 'on', each: 'on', order: 'each-first', on_goal_done: 'on', ch_goal_done: '999999999999999999' });
    assert(save.status === 302, 'saved');
    const be = require('../bot/modules/botEvents').read(await S());
    assert(be.summary && be.each && be.order === 'each-first' && be.types.goal_done.on && !be.types.season_end.on, 'stored');
    assert(be.types.goal_done.channelId === null, 'foreign channel refused');
    const eco = await get('/economy');
    assert(eco.text.includes('/events"') && eco.text.includes('отдельное сообщение на каждый раздел, затем сводка'), 'economy explains and links');
    const ex = await post('/events/example/goal_done', {});
    assert(/events\?(tr_post|example)/.test(ex.headers.get('location')), ex.headers.get('location'));
    const q = await post('/economy-treasury/split', { amount: '1', back: 'events' });
    assert(q.headers.get('location').includes('/events?'), 'quick start returns to events');
  });
  await test('actions: split, goal fund and cancel, deal resolve, codes batch, csv, revoke, season end', async () => {
    let r = await post('/economy-treasury/split', { amount: '100' });
    assert(r.headers.get('location').includes('split=1'), r.headers.get('location'));
    const goal = await db.EconomyGoal.findOne({ where: { guildId: G, status: 'open' } });
    r = await post(`/economy-treasury/goal/${goal.id}/fund`, { amount: '50' });
    assert(r.headers.get('location').includes('goalfund'), r.headers.get('location'));
    assert((await goal.reload()).raised === 150, 'raised');
    r = await post(`/economy-treasury/goal/${goal.id}/cancel`, {});
    assert((await goal.reload()).status === 'cancelled', 'cancelled');
    const deal = await db.EconomyDeal.findOne({ where: { guildId: G } });
    await post(`/economy-deals/${deal.id}/resolve`, { to: 'seller' });
    assert((await deal.reload()).status === 'done', 'deal done');
    const before = await ledger.treasuryOf(G);
    r = await post('/economy-deals/codes', { count: '3', amount: '10', source: 'treasury' });
    assert(r.headers.get('location').includes('codes=1') && await ledger.treasuryOf(G) === before - 30, 'codes from the treasury');
    const csv = await get('/economy-deals/codes.csv?unused');
    assert(csv.text.split('\n').length === 4 && /DARK-/.test(csv.text), 'csv');
    const code = await db.EconomyGift.findOne({ where: { guildId: G } });
    await post(`/economy-deals/codes/${code.id}/revoke`, {});
    assert(!(await db.EconomyGift.findByPk(code.id)) && await ledger.treasuryOf(G) === before - 20, 'revoked back to the treasury');
    r = await post('/economy-bank/season-end', {});
    assert(r.headers.get('location').includes('seasonend') && (await S()).seasonNumber === 2, 'season');
    const grant = await post('/economy/grant', { userId: '323456789012345678', currency: 'coins', amount: '100' });
    assert(grant.status === 302, 'grant');
    const tx = await db.EconomyTx.findOne({ where: { guildId: G, kind: 'admin' }, order: [['id', 'DESC']] });
    assert(tx && tx.amount === 100, 'admin journal line');
  });

  server.close();
  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : `\n      ${r.e}`}`);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
