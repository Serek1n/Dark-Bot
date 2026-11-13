// Economy wave 1: journal, protection, taxes, central bank, goals, deals, gift codes, work, seasons, treasury, modes.
process.env.DATABASE_PATH = './data/test_economy.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const { MemberProfile, GuildSettings, EconomyTx, EconomyHold, EconomyGoal, EconomyDeal, EconomyBadge } = db;
  const config = require('../bot/modules/econ/config');
  const ledger = require('../bot/modules/econ/ledger');
  const pay = require('../bot/modules/econ/pay');
  const bank = require('../bot/modules/econ/bank');
  const goals = require('../bot/modules/econ/goals');
  const deals = require('../bot/modules/econ/deals');
  const gifts = require('../bot/modules/econ/gifts');
  const seasons = require('../bot/modules/econ/seasons');
  const treasury = require('../bot/modules/econ/treasury');
  const results = [];
  const embeds = () => require('../bot/utils/embeds');
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = 'g1';
  await GuildSettings.findOrCreate({ where: { guildId: G } });
  const settings = () => GuildSettings.findOne({ where: { guildId: G } });
  const setMode = async (body) => { const s = await settings(); const r = config.applyForm(s, body); await s.save(); return r; };
  const wallet = async (u, balance, level = 5) => { const [p] = await MemberProfile.findOrCreate({ where: { guildId: G, userId: u } }); await p.update({ balance, level }); return p; };
  const bal = async (u) => Number((await MemberProfile.findOne({ where: { guildId: G, userId: u } }))?.balance || 0);
  const old = (id) => ({ id, joinedTimestamp: Date.now() - 30 * 86400000 });
  const fresh = (id) => ({ id, joinedTimestamp: Date.now() - 3600000 });
  const treas = async () => ledger.treasuryOf(G);

  await test('simple mode by default: nothing extra on', async () => {
    const s = await settings();
    assert(s.economyMode === 'simple', 'default mode');
    assert(config.enabledKeys(s).length === 0, 'nothing on');
  });
  await test('preset and custom modes; applyForm tells what was switched on', async () => {
    let r = await setMode({ mode: 'preset', preset: 'calm' });
    assert(r.added.includes('work') && r.added.includes('protect'), 'calm added');
    r = await setMode({ mode: 'custom', f_work: 'on', f_treasury: 'on', p_work_cooldownMin: '30', p_treasury_payTax: '999' });
    const s = await settings();
    assert(config.isOn(s, 'treasury') && !config.isOn(s, 'protect'), 'custom flags');
    assert(r.removed.includes('protect') && r.added.includes('treasury'), 'diff');
    assert(config.params(s, 'work').cooldownMin === 30, 'param saved');
    assert(config.params(s, 'treasury').payTax === 50, 'param clamped');
    // preset: an unticked section keeps its numbers
    await setMode({ mode: 'preset', preset: 'community', tune_work: 'off', p_work_cooldownMin: '5' });
    assert(config.params(await settings(), 'work').cooldownMin === 30, 'untuned kept');
    assert(config.announceText(await settings(), 'work').includes('30'), 'announce has the number');
  });
  await test('pay with tax goes to the treasury and to the journal', async () => {
    await setMode({ mode: 'custom', f_treasury: 'on', p_treasury_payTax: '10' });
    await wallet('a', 1000); await wallet('b', 0);
    const r = await pay.pay(await settings(), G, old('a'), old('b'), 'balance', 200);
    assert(r.ok && r.received === 180 && r.tax === 20, JSON.stringify(r));
    assert(await bal('a') === 800 && await bal('b') === 180, 'balances');
    assert(await treas() === 20, 'treasury');
    const h = await ledger.history(G, 'a');
    assert(h.some((x) => x.kind === 'pay_out' && x.amount === -200), 'journal');
  });
  await test('protection: daily limit, newcomer hold, release, return, suspicious chain', async () => {
    await setMode({ mode: 'custom', f_protect: 'on', p_protect_payDailyLimit: '300', p_protect_holdHours: '1' });
    await wallet('c', 1000); await wallet('n', 0, 0);
    let r = await pay.pay(await settings(), G, old('c'), old('a'), 'balance', 301);
    assert(!r.ok && r.reason === 'limit', 'limit');
    r = await pay.pay(await settings(), G, old('c'), fresh('n'), 'balance', 100);
    assert(r.ok && r.held, 'held');
    assert(await bal('n') === 0 && await bal('c') === 900, 'not yet');
    assert(await pay.releaseDue(new Date(Date.now() + 2 * 3600000)) === 1, 'released');
    assert(await bal('n') === 100, 'arrived');
    r = await pay.pay(await settings(), G, old('c'), fresh('n'), 'balance', 50);
    const hold = await EconomyHold.findOne({ where: { status: 'held' } });
    assert(await pay.returnHold(G, hold.id) && await bal('c') === 900, 'returned');
    for (const u of ['x1', 'x2', 'x3']) { await wallet(u, 100, 0); await pay.pay(await settings(), G, fresh(u), old('a'), 'balance', 10); }
    const sus = await pay.suspicious(G, { min: 3 });
    assert(sus.length === 1 && sus[0].userId === 'a' && sus[0].senders === 3, JSON.stringify(sus));
  });
  await test('central bank: rate goes down while money grows too fast, never below the floor', async () => {
    await setMode({ mode: 'custom', f_bank: 'on', p_bank_inflationTarget: '5', p_bank_minRate: '50' });
    let s = await settings();
    assert(bank.rateOf(s) === 1, 'rate 1');
    const d0 = new Date(Date.now() - 8 * 86400000);
    await db.EconomySupply.create({ guildId: G, day: ledger.day(d0), coins: 100, crystals: 0, holders: 1, rate: 1 });
    for (let i = 0; i < 10; i++) { await bank.dailyStep(await settings(), new Date(Date.now() + i * 86400000)); }
    s = await settings();
    assert(s.econRate < 1 && s.econRate >= 0.5, `rate ${s.econRate}`);
    assert(bank.rateOf(s) >= 0.5, 'floor');
    const rep = await bank.report(G, s);
    assert(rep && typeof rep.halfShare === 'number', 'report');
  });
  await test('goals: contribute, boost on completion, refund on expiry', async () => {
    await setMode({ mode: 'custom', f_goals: 'on' });
    await wallet('a', 1000); await wallet('b', 1000);
    let r = await goals.create(await settings(), { title: 'Буст', target: 300, days: 3, action: 'boost', boostMult: 2, boostHours: 24 });
    assert(r.goal || r.error === 'channel', JSON.stringify(r.error));
    if (r.error === 'channel') { const s = await settings(); s.economyEventsChannelId = null; r = { goal: await EconomyGoal.create({ guildId: G, title: 'Буст', target: 300, raised: 0, endsAt: new Date(Date.now() + 86400000), action: 'boost', boostMult: 2, boostHours: 24, status: 'open' }) }; }
    let c = await goals.contribute(G, r.goal.id, 'a', 100);
    assert(c.ok && c.put === 100, 'put');
    c = await goals.contribute(G, r.goal.id, 'b', 500);
    assert(c.ok && c.put === 200, 'only what is missing');
    assert((await r.goal.reload()).status === 'done', 'done');
    const s = await settings();
    assert(new Date(s.xpBoostUntil) > new Date() && Number(s.xpBoostMult) === 2, 'boost set');
    const tb = require('../bot/modules/xpBoosts').totalBoost(s, null, null);
    assert(tb.xp === 2, `xp boost ${tb.xp}`);
    const g2 = await EconomyGoal.create({ guildId: G, title: 'Не успеем', target: 1000, raised: 0, endsAt: new Date(Date.now() + 1000), action: 'announce', status: 'open' });
    await goals.contribute(G, g2.id, 'a', 50);
    assert(await bal('a') === 850, 'spent');
    await goals.expireDue(new Date(Date.now() + 5000));
    assert((await g2.reload()).status === 'failed' && await bal('a') === 900, 'refunded');
  });
  await test('deals: money frozen, both done → seller paid minus tax; dispute → moderator', async () => {
    await setMode({ mode: 'custom', f_deals: 'on', f_treasury: 'on', p_treasury_dealTax: '10' });
    await wallet('buyer', 500); await wallet('seller', 0);
    const t0 = await treas();
    const r = await deals.open(await settings(), G, 'buyer', 'seller', 300, 'Аватар', 'ch');
    assert(r.deal && await bal('buyer') === 200, 'frozen');
    assert((await deals.open(await settings(), G, 'buyer', 'seller', 900, 'X', 'ch')).error, 'no money');
    await r.deal.update({ status: 'active', buyerDone: true, sellerDone: true });
    await deals.settle(r.deal, 'seller', 'done', await settings());
    assert(await bal('seller') === 270 && await treas() === t0 + 30, `seller ${await bal('seller')}`);
    const r2 = await deals.open(await settings(), G, 'buyer', 'seller', 100, 'Спорная', 'ch');
    await r2.deal.update({ status: 'disputed' });
    await deals.settle(r2.deal, 'buyer', 'refunded', await settings());
    assert(await bal('buyer') === 200, 'refunded to buyer');
    assert((await EconomyDeal.findByPk(r2.deal.id)).status === 'refunded', 'status');
    // a deal nobody accepted expires and the buyer gets his money back
    const r3 = await deals.open(await settings(), G, 'buyer', 'seller', 50, 'Забыли', 'ch');
    await r3.deal.update({ expiresAt: new Date(Date.now() - 1000) });
    await deals.expireDue();
    assert(await bal('buyer') === 200, 'expired refund');
  });
  await test('gift codes: one use, not your own, daily limit; admin batch from the treasury', async () => {
    await wallet('g', 1000); await wallet('h', 0);
    const p = { maxPerDay: 2, minAmount: 10 };
    assert((await gifts.create(G, 'g', 5, p)).error === 'min', 'min');
    const r = await gifts.create(G, 'g', 100, p);
    assert(/^DARK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(r.code) && await bal('g') === 900, 'created');
    assert((await gifts.redeem(G, 'g', r.code)).error === 'own', 'own');
    const ok = await gifts.redeem(G, 'h', r.code.toLowerCase());
    assert(ok.amount === 100 && await bal('h') === 100, 'redeemed');
    assert((await gifts.redeem(G, 'a', r.code)).error === 'used', 'used');
    await gifts.create(G, 'g', 10, p);
    assert((await gifts.create(G, 'g', 10, p)).error === 'limit', 'limit');
    const before = await treas();
    const batch = await gifts.createBatch(G, { count: 3, amount: 10, source: 'treasury' });
    assert((batch.codes || []).length === 3 || batch.error === 'treasury', JSON.stringify(batch).slice(0, 80));
    if (batch.codes) assert(await treas() === before - 30, 'treasury paid');
  });
  await test('work: paid once per cooldown, more for higher level', async () => {
    await setMode({ mode: 'custom', f_work: 'on', p_work_min: '10', p_work_max: '10', p_work_perLevel: '5', p_work_cooldownMin: '60' });
    await wallet('w', 0, 4);
    const work = require('../bot/commands/economy/work');
    const replies = [];
    const it = { guild: { id: G }, user: { id: 'w' }, reply: async (p) => { replies.push(p); } };
    await work.execute(it);
    assert(await bal('w') === 30, `paid ${await bal('w')}`);
    await work.execute(it);
    assert(await bal('w') === 30, 'cooldown');
    assert(replies.length === 2, 'answered twice');
    assert((await ledger.history(G, 'w')).some((x) => x.kind === 'work'), 'journal');
  });
  await test('seasons: coins reset, badges for the top, crystals stay', async () => {
    await setMode({ mode: 'custom', f_seasons: 'on', p_seasons_top: '2' });
    let s = await settings();
    await seasons.ensureStarted(s);
    await MemberProfile.update({ crystals: 7 }, { where: { guildId: G, userId: 'a' } });
    s = await settings();
    const n = s.seasonNumber;
    await seasons.endSeason(s);
    const badges = await EconomyBadge.findAll({ where: { guildId: G } });
    assert(badges.length === 2, `badges ${badges.length}`);
    assert(await MemberProfile.sum('balance', { where: { guildId: G } }) === 0, 'reset');
    assert(Number((await MemberProfile.findOne({ where: { guildId: G, userId: 'a' } })).crystals) === 7, 'crystals stay');
    assert((await settings()).seasonNumber === n + 1, 'next season');
    const top = badges.find((b) => b.place === 1);
    assert((await seasons.badgeText(G, top.userId)) === `Сезон ${n} · #1`, 'badge text');
  });
  await test('treasury: split among active members', async () => {
    await ledger.treasuryAdd(G, 100);
    await ledger.earnMany(G, ['a', 'b'], 'chat', 'coins', 1);
    const r = await treasury.split(G, 100);
    assert(r.people >= 2 && r.each >= 1, JSON.stringify(r));
  });
  await test('history merges journal and daily income', async () => {
    await ledger.earn(G, 'a', 'chat', 'coins', 15);
    await ledger.earn(G, 'a', 'chat', 'coins', 5);
    const h = await ledger.history(G, 'a');
    const chat = h.find((x) => x.kind === 'chat');
    assert(chat && chat.amount === 21 && chat.daily, 'chat line (1 from the split test + 20)');
    assert(ledger.kindLabel('pay_out') && ledger.kindLabel('???'), 'labels');
    assert(await EconomyTx.count() > 0, 'tx');
  });
  await test('bot events: defaults from the old choice, switches, own channels, announcement order', async () => {
    const be = require('../bot/modules/botEvents');
    const ev = require('../bot/modules/econ/events');
    let s = await settings();
    s.economyEventsMode = 'each'; s.botEvents = '{}'; s.economyEventsChannelId = '100000000000000001';
    let r = be.read(s);
    assert(r.enabled && r.each && !r.summary, 'legacy each');
    be.applyForm(s, { summary: 'on', each: 'on', order: 'each-first', on_activation: 'on', on_goal_done: 'on', ch_season_end: '100000000000000002', on_season_end: 'on' }, (id) => id !== '999999999999999999');
    r = be.read(s);
    assert(r.summary && r.each && r.order === 'each-first', 'order saved');
    assert(!r.types.goal_failed.on && r.types.goal_open.on && r.types.vote.on, 'required stay on, unticked off');
    assert(be.channelIdFor(s, 'season_end') === '100000000000000002' && be.channelIdFor(s, 'goal_done') === '100000000000000001', 'channels');
    assert(be.activationPlan(s).startsWith('отдельное'), 'plan text');
    const sent = [];
    const ch = (id) => ({ id, send: async (p) => { sent.push(`${id.slice(-1)}:${p.embeds[0].data.title}`); return { id: 'm' }; } });
    const c = { channels: { cache: new Map([['100000000000000001', ch('100000000000000001')], ['100000000000000002', ch('100000000000000002')]]) } };
    s.economyFeatures = JSON.stringify({ work: true, gifts: true });
    assert(await ev.announceActivation(s, ['work', 'gifts'], c) === 3, 'three messages');
    assert(sent[0].includes('Работа') && sent[2].includes('Что нового'), 'sections first, summary last: ' + sent.join(' | '));
    sent.length = 0;
    assert(!(await ev.post(s, embeds().info('x'), c, 'goal_failed')), 'switched-off event not posted');
    await ev.post(s, embeds().info('x'), c, 'season_end');
    assert(sent[0].startsWith('2:'), 'own channel');
    be.applyForm(s, { summary: 'on', on_activation: 'on' });
    sent.length = 0;
    await ev.announceActivation(s, ['work'], c);
    assert(sent.length === 1 && sent[0].includes('Что нового'), 'summary only');
    s.botEventsEnabled = false;
    assert(!(await ev.channelOf(s, c, 'vote')), 'module off: even required events are not posted');
    s.botEventsEnabled = true; s.botEvents = '{}'; s.economyEventsMode = 'summary';
    await s.save();
  });
  await test('balance card draws', async () => {
    const card = require('../bot/modules/econ/balanceCard');
    const png = await card.renderBalanceCard({ username: 'Тест', avatarURL: null, balance: 1234, crystals: 5, currencyName: 'монет', crystalName: 'кристаллов', rank: 2, total: 10, deltas: [{ day: ledger.day(), coins: 10 }], ops: [{ kind: 'work', amount: 10, currency: 'coins', at: new Date() }], badge: 'Сезон 1 · #1' });
    assert(png && png.length > 1000, 'png');
  });

  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : `\n      ${r.e}`}`);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
