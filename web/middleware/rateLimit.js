// A small in-memory rate limiter (the panel is one process). Counts requests per key in a time window.
function rateLimit({ windowMs, max, key = (req) => req.user?.id || req.ip, message = 'Слишком много запросов. Подождите немного и повторите.', now = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = now();
  return function limiter(req, res, next) {
    const t = now();
    if (t - lastSweep > windowMs) { // forget finished windows so the map cannot grow forever
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      lastSweep = t;
    }
    const k = String(key(req) || 'unknown');
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= t) { entry = { count: 0, resetAt: t + windowMs }; hits.set(k, entry); }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      return res.status(429).render('error', { message });
    }
    next();
  };
}

module.exports = { rateLimit };
