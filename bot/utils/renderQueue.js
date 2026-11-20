// Pictures (profile, top, level-up, achievement and welcome cards, the panel's previews, re-drawn catalog screenshots) are
// drawn on the CPU and take tens of MB each. Many at once — a busy server, a flood of previews — would stall the bot's
// answers and swell its memory. At most RENDER_CONCURRENCY are drawn at the same time, the rest wait their turn; a queue
// that grows too long refuses at once (the caller shows its usual «could not draw» fallback) instead of waiting forever.
const MAX = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 3);
const MAX_WAITING = 60;
let active = 0;
const waiting = [];

class RenderBusy extends Error {}

function next() {
  if (active >= MAX || !waiting.length) return;
  active++;
  const { fn, resolve, reject } = waiting.shift();
  Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
}

/** Runs `fn` (an async drawing) when a slot is free. */
function run(fn) {
  if (waiting.length >= MAX_WAITING) return Promise.reject(new RenderBusy('Слишком много картинок рисуется сейчас — попробуйте через несколько секунд.'));
  return new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

/** The same function, drawn through the queue. */
const limited = (fn) => (...args) => run(() => fn(...args));

module.exports = { run, limited, RenderBusy, stats: () => ({ active, waiting: waiting.length, max: MAX }) };
