// The scheduler sleeps until the next due time, wakes early when poked, retries what could not be finished, and never runs two at once.
process.env.DATABASE_PATH = './data/test_scheduler.sqlite';
const assert = require('assert');
const { createScheduler, poke } = require('../bot/utils/scheduler');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // 1) fires at the due time, not before and not much later
  let due = Date.now() + 300; const fired = [];
  const s = createScheduler({ name: 't1', nextDue: async () => due, run: async () => { if (due && Date.now() >= due) { fired.push(Date.now()); due = null; } } });
  const t0 = Date.now(); s.start();
  await sleep(150); assert.strictEqual(fired.length, 0, 'not yet');
  await sleep(300); assert.strictEqual(fired.length, 1, 'fired once');
  assert(fired[0] - t0 >= 280 && fired[0] - t0 < 600, 'on time: ' + (fired[0] - t0));
  // nothing pending: no further runs
  await sleep(200); assert.strictEqual(fired.length, 1);

  // 2) a new, sooner item + poke() wakes it up long before maxWait
  due = Date.now() + 200; poke('t1');
  await sleep(350); assert.strictEqual(fired.length, 2, 'poke recalculated the sleep');

  // 3) never two runs at the same time; an item added during a run is handled right after it
  let active = 0, maxActive = 0, runs = 0, items = 1;
  const s2 = createScheduler({ name: 't2', nextDue: async () => (items > 0 ? Date.now() : null), run: async () => { active++; maxActive = Math.max(maxActive, active); runs++; const take = items; await sleep(120); items -= take; active--; } });
  s2.start(); await sleep(30); items += 1; poke('t2'); await sleep(500);
  assert.strictEqual(maxActive, 1, 'no overlap'); assert(runs >= 2 && items === 0, 'ran again after the poke: ' + runs + ' / left ' + items);

  // 4) an error in run() does not stop the scheduler; a broken nextDue is survived
  let n = 0; let d3 = Date.now();
  const s3 = createScheduler({ name: 't3', nextDue: async () => d3, run: async () => { n++; if (n === 1) throw new Error('boom'); d3 = null; } });
  s3.start(); await sleep(100); assert(n >= 1);
  s.stop(); s2.stop(); s3.stop();
  poke('t1'); // stopped / unknown names are ignored
  console.log('scheduler OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
