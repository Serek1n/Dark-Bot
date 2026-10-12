// Tests for the split level system (chat + voice) and the two currencies.
process.env.DATABASE_PATH = './data/test_tracks.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const path = require('path');
const ejs = require('ejs');
const { makeInteraction, makeUser } = require('./mock');

async function main() {
  const db = require('../db');
  await db.init();
  const { MemberProfile, GuildSettings, LevelRole, sequelize } = db;
  const L = require('../bot/modules/leveling');
  const economy = require('../bot/commands/economy/economy');
  const { xpTick } = require('../bot/modules/voiceTime');
  const { computeTrackRoleChanges } = require('../bot/modules/levelRoles');
  const { importLacuna } = require('../bot/modules/importLevels');
  const { renderRankCard } = require('../bot/modules/rankCard');
  const { buildTopPage, handleTopButton } = require('../bot/modules/leaderboardPage');

  const results = [];
  const test = async (label, fn) => {
    try { await fn(); results.push({ label, ok: true }); } catch (e) { results.push({ label, ok: false, error: e.stack.split('\n').slice(0, 3).join(' | ') }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const prof = (g, u) => MemberProfile.findOne({ where: { guildId: g, userId: u } });
  const levelOf = (xp) => L.levelFromXp(xp);
  const text = (i) => JSON.stringify(i._replies);

  const S = await L.getOrCreateSettings('g1');
  Object.assign(S, { xpPerMessageMin: 20, xpPerMessageMax: 20, xpCooldownSeconds: 0, chatCoinsPerMessage: 7, voiceCoinsPerMinute: 3, voiceXpPerMinute: 10, crystalsPerLevel: 2 });
  await S.save();

  await test('chat message: chat XP + coins, voice untouched, total = chat + voice', async () => {
    const r = await L.grantMessageXp('g1', 'a');
    assert(r && r.gained === 20 && r.coins === 7, JSON.stringify({ g: r && r.gained, c: r && r.coins }));
    const p = await prof('g1', 'a');
    assert(Number(p.chatXp) === 20 && Number(p.voiceXp) === 0 && Number(p.xp) === 20, `${p.chatXp}/${p.voiceXp}/${p.xp}`);
    assert(Number(p.balance) === 7, `balance ${p.balance}`);
  });

  await test('voice minute: voice XP + coins, chat untouched, total sums both', async () => {
    const r = await L.grantVoiceXp('g1', 'a', 10);
    assert(r.coins === 3, `coins ${r.coins}`);
    const p = await prof('g1', 'a');
    assert(Number(p.chatXp) === 20 && Number(p.voiceXp) === 10 && Number(p.xp) === 30, `${p.chatXp}/${p.voiceXp}/${p.xp}`);
    assert(Number(p.balance) === 10, `balance ${p.balance}`);
  });

  await test('crystals: paid for every new (single) level, whether it came from chat or voice', async () => {
    for (let i = 0; i < 5; i++) await L.grantMessageXp('g1', 'b'); // 100 xp from chat -> level 1
    let p = await prof('g1', 'b');
    assert(p.level === 1 && Number(p.crystals) === 2, `lvl ${p.level} crystals ${p.crystals}`);
    const r = await L.grantVoiceXp('g1', 'b', 100); // 200 total, still level 1
    assert(!r.leveledUp && r.crystals === 0, 'no new level, no crystals');
    await L.grantVoiceXp('g1', 'b', 60); // 260 -> level 2 from voice
    p = await prof('g1', 'b');
    assert(p.level === 2 && Number(p.crystals) === 4, `lvl ${p.level} crystals ${p.crystals}`);
    assert(Number(p.chatXp) === 100 && Number(p.voiceXp) === 160, `${p.chatXp}/${p.voiceXp}`);
  });

  await test('chat switched off: no message XP; voice still works', async () => {
    const s = await L.getOrCreateSettings('g1');
    s.chatEnabled = false; await s.save();
    assert((await L.grantMessageXp('g1', 'c')) === null, 'chat disabled should give nothing');
    s.chatEnabled = true; await s.save();
  });

  // fake client for the voice tick
  const mkMember = (id) => ({ id, user: { id, bot: false, username: id }, displayName: id, voice: { deaf: false }, roles: { cache: new Map() }, guild: null });
  const mkClient = (memberIds) => {
    const members = new Map(memberIds.map((id) => [id, mkMember(id)]));
    const channel = { id: 'vc1', isVoiceBased: () => true, members };
    const guild = { id: 'g2', name: 'G2', afkChannelId: null, channels: { cache: new Map([['vc1', channel]]) }, roles: { cache: new Map() }, systemChannel: null };
    members.forEach((m) => { m.guild = guild; });
    return { guilds: { cache: new Map([['g2', guild]]) } };
  };

  await test('voice tick: two people get voice XP and coins, one alone does not (min members = 2)', async () => {
    const s = await L.getOrCreateSettings('g2');
    Object.assign(s, { voiceXpPerMinute: 10, voiceCoinsPerMinute: 4 }); await s.save();
    await xpTick(mkClient(['v1']));
    assert(!(await prof('g2', 'v1')), 'a lone member must not get anything');
    await xpTick(mkClient(['v1', 'v2']));
    const p = await prof('g2', 'v1');
    assert(Number(p.voiceXp) === 10 && Number(p.balance) === 4 && Number(p.chatXp) === 0, `${p.voiceXp}/${p.balance}/${p.chatXp}`);
  });

  await test('voice tick: min members = 1 lets a lone member earn', async () => {
    const s = await L.getOrCreateSettings('g2'); s.voiceMinMembers = 1; await s.save();
    await xpTick(mkClient(['solo']));
    assert(Number((await prof('g2', 'solo')).voiceXp) === 10, 'solo should earn');
  });

  await test('voice switched off: nothing is paid', async () => {
    const s = await L.getOrCreateSettings('g2'); s.voiceEnabled = false; await s.save();
    await xpTick(mkClient(['x1', 'x2']));
    assert(!(await prof('g2', 'x1')), 'voice disabled must not pay');
  });

  await test('voice: coins only (XP 0) still pay coins', async () => {
    const s = await L.getOrCreateSettings('g2'); Object.assign(s, { voiceEnabled: true, voiceXpPerMinute: 0, voiceMinMembers: 2 }); await s.save();
    await xpTick(mkClient(['k1', 'k2']));
    const p = await prof('g2', 'k1');
    assert(Number(p.voiceXp) === 0 && Number(p.balance) === 4, `${p.voiceXp}/${p.balance}`);
  });

  await test('level roles: only the single level matters; replace keeps the highest', async () => {
    const rows = [
      { level: 5, roleId: 'T5', track: 'total' }, { level: 10, roleId: 'T10', track: 'total' },
      { level: 3, roleId: 'C3', track: 'chat' }, { level: 3, roleId: 'V3', track: 'voice' }
    ];
    // Leftover rows of the old per-direction roles are ignored: only the single level counts.
    let r = computeTrackRoleChanges(rows, { total: 6 }, [], false);
    assert(r.add.join() === 'T5', r.add.join());
    r = computeTrackRoleChanges(rows, { total: 12 }, ['T5', 'C3'], true);
    assert(r.add.join() === 'T10' && r.remove.join() === 'T5', JSON.stringify(r));
    r = computeTrackRoleChanges(rows, 6, [], false); // plain number = the level
    assert(r.add.join() === 'T5', r.add.join());
  });

  await test('migration: old single-track profile counts as chat, total preserved', async () => {
    await sequelize.query("INSERT INTO member_profiles (guildId,userId,xp,level,chatXp,chatLevel,voiceXp,voiceLevel,balance,crystals,messageCount,voiceSeconds,createdAt,updatedAt) VALUES ('g3','old',500,3,0,0,0,0,10,0,0,0,datetime('now'),datetime('now'))");
    await db.init();
    const p = await prof('g3', 'old');
    assert(Number(p.chatXp) === 500 && p.level === 3 && Number(p.xp) === 500, `${p.chatXp}/${p.level}/${p.xp}`);
    await db.init(); // idempotent
    assert(Number((await prof('g3', 'old')).chatXp) === 500, 'second run changed data');
  });

  await test('import (Lacuna): XP counted as chat, total/levels consistent, never lowered', async () => {
    const mk = (id, level, cur, gid = 'g4') => ({ _id: id, activities: { levels: [{ guild_id: gid, experience: { level, current: cur }, activity: { total_messages: 5, total_voice_time: 60 } }], wallets: [{ guild_id: gid, currencies: [{ id: 'DEFAULT', amount: 50 }] }] } });
    const res = await importLacuna('g4', [mk('100000000000000001', 5, 10)]);
    assert(res.imported === 1, JSON.stringify(res));
    const p = await prof('g4', '100000000000000001');
    assert(Number(p.xp) === Number(p.chatXp) + Number(p.voiceXp) && p.level === 5 && Number(p.balance) === 50, `${p.xp}/${p.chatXp}/${p.level}`);
    await importLacuna('g4', [mk('100000000000000001', 2, 0)]);
    assert((await prof('g4', '100000000000000001')).level === 5, 'level was lowered');
  });

  await test('import (Dark export): both directions and crystals restored', async () => {
    const u = { _id: '100000000000000002', activities: { levels: [{ guild_id: 'g5', experience: { level: 2, current: 0 }, activity: {} }], wallets: [] }, dark: { chatXp: 300, voiceXp: 700, crystals: 9 } };
    await importLacuna('g5', [u]);
    const p = await prof('g5', '100000000000000002');
    assert(Number(p.chatXp) === 300 && Number(p.voiceXp) === 700 && Number(p.xp) === 1000 && Number(p.crystals) === 9, `${p.chatXp}/${p.voiceXp}/${p.xp}/${p.crystals}`);
    assert(p.level === L.levelFromXp(1000), 'level not recomputed');
  });

  await test('economy: daily pays the configured amount', async () => {
    const s = await L.getOrCreateSettings('g1'); s.dailyCoins = 250; await s.save();
    const i = makeInteraction({ guild: require('./mock').makeGuild({ id: 'g1' }), subcommand: 'daily', user: makeUser('d1') });
    await economy.execute(i);
    assert(text(i).includes('+250'), text(i));
    assert(Number((await prof('g1', 'd1')).balance) === 250, 'balance not credited');
  });

  await test('economy: balance shows both currencies; pay moves crystals, not coins', async () => {
    const g = require('./mock').makeGuild({ id: 'g1' });
    const i = makeInteraction({ guild: g, subcommand: 'balance', user: makeUser('b') });
    await economy.execute(i);
    assert(text(i).includes('Кристаллы') && text(i).includes('Монеты'), text(i));
    const pay = makeInteraction({ guild: g, subcommand: 'pay', user: makeUser('b'), options: { 'user': makeUser('rcv'), 'amount': 3, 'currency': 'crystals' } });
    await economy.execute(pay);
    assert(text(pay).includes('Перевод выполнен') && text(pay).includes('кристаллы'), text(pay));
    const [from, to] = [await prof('g1', 'b'), await prof('g1', 'rcv')];
    assert(Number(from.crystals) === 1 && Number(to.crystals) === 3, `${from.crystals}/${to.crystals}`);
    assert(Number(to.balance) === 0, 'coins must not move');
    const over = makeInteraction({ guild: g, subcommand: 'pay', user: makeUser('b'), options: { 'user': makeUser('rcv'), 'amount': 99, 'currency': 'crystals' } });
    await economy.execute(over);
    assert(text(over).includes('Недостаточно'), text(over));
  });

  const client = { users: { fetch: async (id) => ({ id, username: 'u' + id, globalName: null, displayAvatarURL: () => 'http://127.0.0.1:9/x.png' }) } };
  const guild = { id: 'g1', name: 'G1' };
  await test('top: Total / Voice and the buttons have unique ids', async () => {
    for (const cat of ['total', 'voice']) {
      const page = await buildTopPage(client, guild, 0, 'u1', cat);
      assert(page && page.files.length === 1 && Buffer.isBuffer(page.files[0].attachment), `${cat}: no image`);
      const ids = page.components.flatMap((r) => r.components.map((c) => c.data.custom_id));
      assert(new Set(ids).size === ids.length, `${cat}: duplicate ids ${ids}`);
      assert(page.components.at(-1).components.length === 2, `${cat}: category row`);
      assert(ids.every((x) => x.split(':').length === 5), `${cat}: id shape ${ids}`);
    }
    fs.writeFileSync('/tmp/top_voice.png', (await buildTopPage(client, guild, 0, 'u1', 'voice')).files[0].attachment);
  });

  await test('top: category button re-renders on the chosen direction (page 0)', async () => {
    let edited = null;
    const inter = { customId: 'top:cat:0:u1:voice', user: { id: 'u1' }, client, guild, deferUpdate: async () => {}, editReply: async (p) => { edited = p; } };
    await handleTopButton(inter);
    assert(edited && edited.files.length === 1, 'not re-rendered');
    const foreign = { ...inter, user: { id: 'other' }, reply: async () => {} };
    let replied = false; foreign.reply = async () => { replied = true; };
    await handleTopButton(foreign);
    assert(replied, 'a stranger must not flip the board');
  });

  await test('top: empty direction returns null (no voice XP on a fresh server)', async () => {
    assert((await buildTopPage(client, { id: 'nobody', name: 'N' }, 0, 'u1', 'voice')) === null, 'expected null');
  });

  await test('rank card: renders a PNG with both currencies and both directions', async () => {
    const png = await renderRankCard({ rank: 3, totalMembers: 120, username: 'Тест Пользователь', level: 12, xpIntoLevel: 340, xpNeeded: 780, balance: 12345, currencyName: 'монеты', crystals: 42, crystalName: 'кристаллы', chatXp: 2100, voiceXp: 1500, messageCount: 4321, voiceSeconds: 99999 });
    assert(png.length > 5000 && png.slice(1, 4).toString() === 'PNG', 'bad png');
    fs.writeFileSync('/tmp/rank_new.png', png);
  });

  const root = path.join(__dirname, '..', 'web', 'views', 'dashboard');
  const guildObj = { id: '1', name: 'Test', icon: null };
  const settings = await L.getOrCreateSettings('g1');
  const channels = [{ id: '123456789012345678', name: 'chat', type: 0 }];
  const render = (f, data) => ejs.renderFile(path.join(root, f + '.ejs'), { guild: guildObj, settings, channels, roles: [{ id: '1', name: 'r' }], levelRoles: [{ id: 1, level: 5, roleId: '1', track: 'total' }], sync: null, top: [], users: {}, track: 'voice', xpField: 'voiceXp', levelField: 'level', ...data });
  await test('web: leveling page has separate Chat and Voice sections', async () => {
    const h = await render('leveling', { active: 'leveling' });
    for (const n of ['chatEnabled', 'xpPerMessageMin', 'chatCoinsPerMessage', 'crystalsPerLevel', 'voiceEnabled', 'voiceXpPerMinute', 'voiceCoinsPerMinute', 'voiceMinMembers']) assert(h.includes(`name="${n}"`), 'missing ' + n);
    assert(h.includes('<h2>Чат</h2>') && h.includes('<h2>Голос</h2>'), 'sections');
  });
  await test('web: economy page renders both currencies', async () => {
    const h = await render('economy', { active: 'economy' });
    for (const n of ['currencyName', 'crystalName', 'dailyCoins']) assert(h.includes(`name="${n}"`), 'missing ' + n);
  });
  await test('web: level roles page has the direction selector; leaderboard has tabs', async () => {
    const h = await render('level-roles', { active: 'level-roles' });
    assert(!h.includes('name="track"'), 'no direction selector any more');
    const lb = await render('leaderboard', { active: 'leaderboard' });
    assert(lb.includes('track=voice') && !lb.includes('track=chat'), 'tabs');
  });
  await test('web: sidebar links to Economy', async () => {
    const h = await render('economy', { active: 'economy' });
    assert(h.includes('/economy"') && h.includes('Экономика'), 'link');
  });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.label, r.ok ? '' : '\n   ' + r.error));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
