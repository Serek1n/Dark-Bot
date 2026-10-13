// Slash command names (English, flat): registration shape and that each name reaches the right action.
process.env.DATABASE_PATH = './data/test_names.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { makeInteraction, makeUser } = require('./mock');
(async () => {
  await require('../db').init();
  const cmds = require('../bot/handlers/loadCommands').loadCommands();
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.message }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const text = (i) => JSON.stringify(i._replies);
  const run = async (name, opts = {}) => { const i = makeInteraction({ subcommand: 'IGNORED', ...opts }); await cmds.get(name).execute(i); return i; };

  await test('exactly the expected commands are registered, old names are gone', async () => {
    const names = [...cmds.keys()].sort();
    assert(names.join() === ['Report message', 'balance', 'play', 'mod', 'daily', 'pay', 'shop', 'help', 'profile', 'top'].sort().join(), names.join());
  });
  await test('all names/options are valid for Discord (lowercase, 1-32 chars) and descriptions <= 100', async () => {
    const re = /^[-_\p{L}\p{N}]{1,32}$/u;
    for (const [n, c] of cmds) {
      const j = c.data.toJSON(); if (j.type === 3) { assert(j.name.length <= 32, 'ctx name'); continue; }
      const walk = (o) => { assert(re.test(o.name) && o.name === o.name.toLowerCase(), 'bad name ' + o.name); assert(!o.description || o.description.length <= 100, 'long description ' + o.name); (o.options || []).forEach(walk); };
      walk(j);
    }
  });
  await test('/daily, /balance, /pay', async () => {
    assert(text(await run('daily', { user: makeUser('n1') })).includes('Награда получена'), 'daily');
    assert(text(await run('balance', { user: makeUser('n1') })).includes('Баланс'), 'balance');
    const pay = await run('pay', { user: makeUser('n1'), options: { 'user': makeUser('n2'), 'amount': 10 } });
    assert(text(pay).includes('Перевод выполнен'), text(pay));
  });
  await test('/profile and /top', async () => {
    const p = await run('profile'); assert(p._replies.length > 0, 'profile no reply');
    const t = await run('top', { options: { 'rating': 'total' } }); assert(t._replies.length > 0, 'top no reply');
  });
  await test('/play asks to join a voice channel when the user is not in one', async () => {
    assert(text(await run('play', { options: { 'query': 'x' } })).includes('голосовой канал'), 'music');
  });
  await test('/mod subcommands reach the actions', async () => {
    const g = require('./mock').makeGuild();
    const w = makeInteraction({ guild: g, subcommand: 'warn', options: { 'user': makeUser('victim'), 'reason': 'x' } });
    await cmds.get('mod').execute(w); assert(text(w).includes('предупреждение'), text(w));
    const l = makeInteraction({ guild: g, subcommand: 'warnings', options: { 'user': makeUser('victim') } });
    await cmds.get('mod').execute(l); assert(l._replies.length > 0, 'list');
    const s = makeInteraction({ subcommand: 'ban', options: { 'user': makeUser('user1') } });
    await cmds.get('mod').execute(s); assert(text(s).includes('самого себя'), text(s));
  });
  await test('/help answers', async () => { assert((await run('help'))._replies.length > 0, 'help'); });

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
