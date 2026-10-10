// Behaviour tests (not just "does not throw"): race conditions, role hierarchy, automod matching.
process.env.DATABASE_PATH = './data/test_logic.sqlite';
require('fs').mkdirSync('./data',{recursive:true});['','-shm','-wal'].forEach((x)=>require('fs').rmSync(process.env.DATABASE_PATH+x,{force:true}));
const { makeInteraction, makeUser, makeMember } = require('./mock');

async function main() {
  const { init, MemberProfile } = require('../db');
  await init();
  const economy = require('../bot/commands/economy/economy');
  const moderation = require('../bot/commands/moderation/moderation');
  const { evaluateMessage } = require('../bot/modules/automod');
  const { grantMessageXp } = require('../bot/modules/leveling');
  const { withLock } = require('../bot/utils/lock');

  const results = [];
  const test = async (label, fn) => {
    try { await fn(); results.push({ label, ok: true }); }
    catch (e) { results.push({ label, ok: false, error: e.message }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const text = (i) => JSON.stringify(i._replies);

  await test('daily: 5 simultaneous claims pay out exactly once', async () => {
    const ints = Array.from({ length: 5 }, () => makeInteraction({ subcommand: 'daily' }));
    await Promise.all(ints.map((i) => economy.execute(i)));
    const paid = ints.filter((i) => text(i).includes('Награда получена')).length;
    assert(paid === 1, `paid ${paid} times`);
    const p = await MemberProfile.findOne({ where: { guildId: 'guild1', userId: 'user1' } });
    assert(Number(p.balance) === 100, `balance ${p.balance}`);
  });

  await test('pay: simultaneous transfers cannot overdraw', async () => {
    const ints = Array.from({ length: 4 }, () =>
      makeInteraction({ subcommand: 'pay', options: { 'пользователь': makeUser('user2'), 'сумма': 60 } }));
    await Promise.all(ints.map((i) => economy.execute(i)));
    const ok = ints.filter((i) => text(i).includes('Перевод выполнен')).length;
    assert(ok === 1, `${ok} transfers succeeded with balance 100 / amount 60`);
    const a = await MemberProfile.findOne({ where: { guildId: 'guild1', userId: 'user1' } });
    const b = await MemberProfile.findOne({ where: { guildId: 'guild1', userId: 'user2' } });
    assert(Number(a.balance) === 40 && Number(b.balance) === 60, `balances ${a.balance}/${b.balance}`);
  });

  await test('xp: burst of messages respects cooldown', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => grantMessageXp('guild1', 'xpuser')));
    const granted = results.filter(Boolean).length;
    assert(granted === 1, `${granted} grants in one burst`);
  });

  await test('mute: cannot act on member with equal/higher role', async () => {
    const guild = require('./mock').makeGuild();
    guild.members.fetch = async (id) => makeMember(id, { rolePosition: 10 });
    const i = makeInteraction({ guild, subcommand: 'mute', options: { 'пользователь': makeUser('user2'), 'минуты': 5 } });
    await moderation.execute(i);
    assert(text(i).includes('не ниже вашей'), text(i));
  });

  await test('ban: cannot ban yourself', async () => {
    const i = makeInteraction({ subcommand: 'ban', options: { 'пользователь': makeUser('user1') } });
    await moderation.execute(i);
    assert(text(i).includes('самого себя'), text(i));
  });

  await test('kick: lower-role member is allowed', async () => {
    const i = makeInteraction({ subcommand: 'kick', options: { 'пользователь': makeUser('user2') } });
    await moderation.execute(i);
    assert(text(i).includes('кикнут'), text(i));
  });

  await test('unban: rejects non-numeric id', async () => {
    const i = makeInteraction({ subcommand: 'unban', options: { id: 'abc' } });
    await moderation.execute(i);
    assert(text(i).includes('только из цифр'), text(i));
  });

  const st = { automodEnabled: true, automodBannedWords: JSON.stringify(['ass', 'слово']), automodBlockInvites: true, automodAntiSpam: false };
  const msg = (content) => ({ content, member: null, guildId: 'g', author: { id: 'u' } });
  await test('automod: does not delete "class"', async () => assert(!(await evaluateMessage(st, msg('first class seats'))), 'false positive'));
  await test('automod: catches banned word and inflection', async () => {
    assert(await evaluateMessage(st, msg('you ass')), 'missed ass');
    assert(await evaluateMessage(st, msg('словом')), 'missed inflection');
  });
  await test('automod: blocks discord invites', async () => assert(await evaluateMessage(st, msg('join discord.gg/abc123')), 'missed invite'));
  await test('automod: special chars in word do not break regex', async () => {
    const s2 = { ...st, automodBannedWords: JSON.stringify(['a(b', '[x']) };
    await evaluateMessage(s2, msg('hello a(b [x'));
  });

  await test('lock: runs tasks for a key in order and survives errors', async () => {
    const order = [];
    await Promise.allSettled([
      withLock('k', async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }),
      withLock('k', async () => { order.push(2); throw new Error('boom'); }),
      withLock('k', async () => { order.push(3); })
    ]);
    assert(order.join() === '1,2,3', order.join());
  });

  for (const r of results) console.log(r.ok ? '✅' : '❌', r.label, r.ok ? '' : `-> ${r.error}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
}
main();
