// Giveaways by command: /giveaway start with a prize the bot pays out by itself (coins, crystals, a role — also for a while),
// the button, the end, a reroll that never pays twice.
process.env.DATABASE_PATH = './data/test_giveaways.sqlite';
const fs = require('fs'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits: P } = require('discord.js');
const { makeInteraction, makeUser } = require('./mock');
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }
const G = '777000000000000001';

(async () => {
  const db = require('../db'); await db.init();
  const gw = require('../bot/modules/giveaways');
  const cmd = require('../bot/commands/utility/giveaway');
  const { getOrCreateSettings } = require('../bot/modules/leveling');
  const s = await getOrCreateSettings(G); s.currencyName = 'монет'; s.crystalName = 'кристаллов'; await s.save();

  // a small server: roles, members, channels
  const role = (id, position, perms = 0n) => ({ id, name: id, position, managed: false, editable: true, permissions: { bitfield: perms } });
  const roles = new Map([['VIP', role('VIP', 3)], ['BOSS', role('BOSS', 9)], ['ADMIN', role('ADMIN', 2, P.Administrator)]]);
  const memberRoles = new Map(); // userId -> Set
  const mkMember = (id) => { if (!memberRoles.has(id)) memberRoles.set(id, new Set()); const set = memberRoles.get(id); return { id, roles: { cache: { has: (r) => set.has(r) }, add: async (r) => set.add(r.id || r), highest: { position: 5 } }, permissions: { has: () => true } }; };
  const posts = []; const channelSends = [];
  const channel = { id: 'CH', send: async (p) => { posts.push(p); return { id: 'MSG' + posts.length }; }, messages: { fetch: async () => ({ id: 'MSG1', edit: async () => {} }) }, permissionsFor: () => ({ has: () => true }) };
  const closed = { id: 'CLOSED', send: async (p) => { channelSends.push(p); return { id: 'X' }; }, permissionsFor: (who) => ({ has: () => who !== 'BOT' }) }; // the organiser may write there, the bot may not
  const guild = { id: G, ownerId: 'OWNER', roles: { cache: roles }, members: { fetch: async (id) => mkMember(id), me: 'BOT' }, channels: { cache: new Map([['CLOSED', closed]]) } };
  const client = { guilds: { cache: new Map([[G, guild]]) }, channels: { fetch: async () => ({ ...channel, send: async (p) => { channelSends.push(p); return {}; } }) } };
  const host = () => ({ ...mkMember('HOST'), permissions: { has: () => true } });
  const start = async (options, extra = {}) => {
    const i = makeInteraction({ subcommand: 'start', options: { duration: '1h', ...options }, guild, user: makeUser(extra.user || 'HOST'), member: extra.member || host(), channel });
    i.channelId = 'CH'; i.client = client;
    await cmd.execute(i);
    return { i, text: JSON.stringify(i._replies) };
  };
  const enter = async (g, ids) => { for (const id of ids) await db.GiveawayEntry.create({ giveawayId: g.id, userId: id }); };
  const bal = async (id) => (await db.MemberProfile.findOne({ where: { guildId: G, userId: id } }))?.balance ?? 0;

  await test('the prize options are read: coins need an amount, an amount alone means coins, a role may be for a while', async () => {
    const r = (o, member = host(), user = 'HOST') => cmd.readReward({ options: makeInteraction({ options: o }).options, guild, member, user: { id: user } });
    assert.deepStrictEqual(r({}), { reward: null });
    assert(/reward_amount/.test(r({ reward: 'coins' }).error));
    assert.deepStrictEqual(r({ reward_amount: 500 }).reward, { type: 'coins', amount: 500 });
    assert.deepStrictEqual(r({ reward: 'crystals', reward_amount: 3 }).reward, { type: 'crystals', amount: 3 });
    assert.deepStrictEqual(r({ reward_role: roles.get('VIP'), reward_time: '7d' }).reward, { type: 'role', roleId: 'VIP', seconds: 7 * 86400, roleName: 'VIP' });
    assert(/управления сервером/.test(r({ reward_role: roles.get('ADMIN') }).error), 'admin role never');
    assert(/ниже вашей/.test(r({ reward_role: roles.get('BOSS') }).error), 'above the organiser');
    assert.strictEqual(r({ reward_role: roles.get('BOSS') }, host(), 'OWNER').reward.roleId, 'BOSS', 'the owner may');
    assert(/366/.test(r({ reward_role: roles.get('VIP'), reward_time: '2y' }).error) && /reward_role/.test(r({ reward_time: '1d' }).error));
  });

  await test('/giveaway start: no prize text needed with an automatic prize; the post says what the bot will give', async () => {
    const { text } = await start({ reward: 'coins', reward_amount: 1000, winners: 2 });
    assert(text.includes('Приз бот выдаст победителям сам'), text);
    const g = await db.Giveaway.findOne({ order: [['id', 'DESC']] });
    assert(g.prize === '1 000 монет' && g.rewardType === 'coins' && g.rewardAmount === 1000 && g.winnersCount === 2, JSON.stringify(g.toJSON()));
    assert(JSON.stringify(posts.at(-1).embeds[0].toJSON()).includes('Приз выдаётся сразу: **1 000 монет**'));
    const none = await start({});
    assert(/Напишите, что разыгрываете/.test(none.text), 'nothing to give');
  });

  await test('/giveaway start in another channel: refused where the bot cannot post', async () => {
    const r = await start({ prize: 'Пицца', channel: { id: 'CLOSED' } });
    assert(/нет прав писать/.test(r.text) && !channelSends.length, r.text);
  });

  await test('the end: every winner gets the coins at once, the post says so; ending again pays nothing', async () => {
    const g = await db.Giveaway.findOne({ where: { rewardType: 'coins' } });
    await enter(g, ['A', 'B']);
    const winners = await gw.finishGiveaway(client, g);
    assert.deepStrictEqual(winners.sort(), ['A', 'B']);
    assert.strictEqual(await bal('A'), 1000); assert.strictEqual(await bal('B'), 1000);
    assert(channelSends.at(-1).content.includes('Уже начислено: 1 000 монет'), channelSends.at(-1).content);
    await gw.finishGiveaway(client, g); assert.strictEqual(await bal('A'), 1000, 'not twice');
  });

  await test('reroll: new winners get the prize, the old ones are never paid twice', async () => {
    await start({ reward: 'crystals', reward_amount: 5 });
    const g = await db.Giveaway.findOne({ where: { rewardType: 'crystals' } });
    await enter(g, ['C', 'D']);
    const first = await gw.finishGiveaway(client, g);
    const second = await gw.finishGiveaway(client, g, { reroll: true });
    assert(first.length === 1 && second.length === 1 && first[0] !== second[0]);
    const cr = async (id) => (await db.MemberProfile.findOne({ where: { guildId: G, userId: id } })).crystals;
    assert(await cr('C') === 5 && await cr('D') === 5, 'each got it once');
    await g.reload(); assert.deepStrictEqual(JSON.parse(g.rewarded).sort(), ['C', 'D']);
  });

  await test('a role for a while: given and put on a term; a role that got admin rights meanwhile is not given', async () => {
    await start({ reward_role: roles.get('VIP'), reward_time: '3d' });
    const g = await db.Giveaway.findOne({ where: { rewardType: 'role' } });
    assert(g.prize === 'Роль «VIP» на 3 д' && g.rewardSeconds === 3 * 86400, g.prize);
    await enter(g, ['E']);
    await gw.finishGiveaway(client, g);
    assert(memberRoles.get('E').has('VIP'));
    const term = await db.TempRole.findOne({ where: { guildId: G, userId: 'E', roleId: 'VIP' } });
    assert(term && term.givenBy === `giveaway:${g.id}` && Math.abs(new Date(term.expiresAt) - Date.now() - 3 * 86400e3) < 5000);

    await start({ reward_role: roles.get('VIP') });
    const g2 = await db.Giveaway.findOne({ where: { rewardType: 'role' }, order: [['id', 'DESC']] });
    roles.get('VIP').permissions.bitfield = P.Administrator; // someone gave the role admin rights after the start
    await enter(g2, ['F']);
    await gw.finishGiveaway(client, g2);
    roles.get('VIP').permissions.bitfield = 0n;
    assert(!memberRoles.get('F')?.has('VIP') && channelSends.at(-1).content.includes('Не удалось выдать приз'), channelSends.at(-1).content);
  });

  await test('a giveaway without an automatic prize works as before', async () => {
    await start({ prize: 'Пицца' });
    const g = await db.Giveaway.findOne({ where: { prize: 'Пицца' } });
    assert(g.rewardType === null);
    await enter(g, ['G1']);
    const w = await gw.finishGiveaway(client, g);
    assert(w[0] === 'G1' && !channelSends.at(-1).content.includes('начислено') && (await bal('G1')) === 0);
  });

  await test('the button: enter, leave, a required role is checked; /giveaway list marks automatic prizes', async () => {
    await start({ prize: 'Кружка', role: roles.get('VIP') });
    const g = await db.Giveaway.findOne({ where: { prize: 'Кружка' } });
    const replies = [];
    const press = (uid, has) => gw.handleGiveawayButton({ customId: `gw:${g.id}`, guildId: G, user: { id: uid }, member: { roles: { cache: { has: () => has } } }, message: null, reply: async (p) => replies.push(JSON.stringify(p)) });
    await press('H', false); assert(replies.at(-1).includes('нужна роль'));
    await press('H', true); assert(replies.at(-1).includes('Вы участвуете') && (await db.GiveawayEntry.count({ where: { giveawayId: g.id } })) === 1);
    await press('H', true); assert(replies.at(-1).includes('вышли') && (await db.GiveawayEntry.count({ where: { giveawayId: g.id } })) === 0);
    const i = makeInteraction({ subcommand: 'list', guild, member: host() }); await cmd.execute(i);
    const list = JSON.stringify(i._replies); assert(list.includes('Кружка') && !list.includes('Кружка 🎁'));
  });

  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
