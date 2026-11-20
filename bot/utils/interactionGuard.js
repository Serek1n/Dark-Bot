// Commands, buttons and menus from one person: at most `max` in `windowMs`. A spammer (or a script clicking a button
// hundreds of times) would otherwise make the bot write to its database for every press and reach Discord's own limits,
// which then slow it down on every server. Over the limit the person is told once per window; the rest are ignored.
const WINDOW_MS = 10000;
const MAX = Number(process.env.BOT_INTERACTIONS_PER_10S) || 12;
const seen = new Map(); // userId → { n, reset, told }
let sweepAt = 0;

/** 'ok' — go on; 'tell' — over the limit, say so once; 'drop' — over the limit, already said. */
function check(userId, t = Date.now()) {
  if (t > sweepAt) { for (const [k, v] of seen) if (v.reset <= t) seen.delete(k); sweepAt = t + WINDOW_MS * 6; }
  let s = seen.get(userId);
  if (!s || s.reset <= t) { s = { n: 0, reset: t + WINDOW_MS, told: false }; seen.set(userId, s); }
  s.n++;
  if (s.n <= MAX) return 'ok';
  if (s.told) return 'drop';
  s.told = true;
  return 'tell';
}

module.exports = { check, WINDOW_MS, MAX, reset: () => seen.clear() };
