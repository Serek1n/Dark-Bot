// The economy's clock: one scheduler wakes when the next thing is due — a held transfer to deliver, a goal or a pending deal whose
// time is up, a season's end, and once a day the central bank's snapshot of every server.
const { GuildSettings, EconomyHold, EconomyGoal, EconomyDeal } = require('../../../db');
const { createScheduler } = require('../../utils/scheduler');
const logger = require('../../utils/logger');
const pay = require('./pay');
const goals = require('./goals');
const deals = require('./deals');
const seasons = require('./seasons');
const bank = require('./bank');

let lastDaily = null;
const nextMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 5, 0); return d; };

async function dailySteps(now = new Date()) {
  const rows = await GuildSettings.findAll();
  let n = 0;
  for (const s of rows) { if (await bank.dailyStep(s, now).catch((err) => { logger.error(`Economy daily step ${s.guildId}:`, err.message); return null; })) n++; }
  lastDaily = require('./ledger').day(now);
  return n;
}

async function nextDue() {
  const [hold, goal, deal, season] = await Promise.all([
    EconomyHold.min('releaseAt', { where: { status: 'held' } }),
    EconomyGoal.min('endsAt', { where: { status: 'open' } }),
    EconomyDeal.min('expiresAt', { where: { status: 'pending' } }),
    seasons.nextEnd()
  ]);
  const times = [hold, goal, deal, season, lastDaily === require('./ledger').day() ? nextMidnight() : new Date()].filter(Boolean).map((d) => new Date(d).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

async function run() {
  const now = new Date();
  await pay.releaseDue(now);
  await goals.expireDue(now);
  await deals.expireDue(now);
  await seasons.endDue(now);
  if (lastDaily !== require('./ledger').day(now)) await dailySteps(now);
}

let scheduler = null;
function startEconomyScheduler() {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'economy', nextDue, run, maxWaitMs: 10 * 60_000 }).start();
}

module.exports = { startEconomyScheduler, run, nextDue, dailySteps };
