// One way to run "things that become due at a certain time" (giveaways, reminders, polls, temporary bans).
// Instead of asking the database every 15 seconds whether anything is due, each kind tells when its NEXT item is due (one cheap
// MIN() query) and the scheduler sleeps exactly until then: the item fires on time, and a quiet server costs almost nothing.
// Whoever creates a new item calls poke(name) so the sleep is recalculated at once.
const logger = require('./logger');

const registry = new Map();
const RETRY_MS = 15_000; // an item that is due but could not be finished (Discord error) is tried again after this

/**
 * nextDue(): Date | number | null — when the earliest pending item is due (null = nothing pending).
 * run(): handles everything that is due now.
 * maxWaitMs: the longest sleep (a safety net in case something was added without poke()).
 */
function createScheduler({ name, nextDue, run, maxWaitMs = 5 * 60_000 }) {
  let timer = null;
  let running = false;
  let again = false;
  let stopped = true;

  async function arm(afterRun) {
    clearTimeout(timer);
    if (stopped) return;
    let wait = maxWaitMs;
    try {
      const due = await nextDue();
      if (due !== null && due !== undefined) {
        const t = new Date(due).getTime();
        const diff = Number.isFinite(t) ? t - Date.now() : 0;
        wait = diff > 0 ? Math.min(maxWaitMs, diff) : afterRun ? RETRY_MS : 0;
      }
    } catch (err) {
      logger.error(`Scheduler ${name}: could not read the next due time:`, err.message);
      wait = Math.min(maxWaitMs, RETRY_MS);
    }
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(fire, wait);
    timer.unref?.();
  }

  async function fire() {
    if (running) { again = true; return; }
    running = true;
    try {
      await run();
    } catch (err) {
      logger.error(`Scheduler ${name} failed:`, err.message);
    } finally {
      running = false;
    }
    const rerun = again; again = false;
    await arm(!rerun);
  }

  const api = {
    name,
    /** Starts (or restarts) the scheduler; whatever is already due runs immediately. */
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(fire, 0); timer.unref?.(); return api; },
    /** Something was added or changed: recalculate how long to sleep. */
    poke() { if (!stopped && !running) arm(false).catch(() => {}); else if (running) again = true; },
    stop() { stopped = true; clearTimeout(timer); registry.delete(name); },
    get running() { return !stopped; }
  };
  registry.set(name, api);
  return api;
}

/** Tells the scheduler `name` that a new item exists. Safe to call when that scheduler is not running (tests, a panel started alone). */
function poke(name) { registry.get(name)?.poke(); }

module.exports = { createScheduler, poke };
