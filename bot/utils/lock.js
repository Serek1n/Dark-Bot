// Tiny in-process mutex keyed by string. The bot runs as a single process, so this is enough to
// stop two simultaneous commands (e.g. a double-clicked /economy daily) from reading the same
// balance and both writing it back.
const tails = new Map();

function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Holds several keys at once. Keys are taken in sorted order, so two callers can never deadlock. */
function withLocks(keys, fn) {
  const sorted = [...new Set(keys)].sort();
  const take = (i) => (i >= sorted.length ? fn() : withLock(sorted[i], () => take(i + 1)));
  return take(0);
}

module.exports = { withLock, withLocks };
