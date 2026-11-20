// Protection of the panel from a flood of requests. The panel runs in the bot's process: if it is buried in requests, the
// bot stops answering Discord too. So, before any page is built:
//  1. a limit per address (nginx limits first, this is the second line — and the only one if the panel is reached directly);
//  2. shedding: when too many pages are being built at once, or the process is already late (event loop lag), a request
//     gets a short «503, try again in a few seconds» instead of waiting — the bot keeps its time;
//  3. a micro-cache: the same public page for anonymous visitors (catalog, a community, legal pages, leaderboards) is
//     built once in a few seconds, whatever the number of visitors.
// The answers are short plain text: building an error page costs as much as the page itself.
const { monitorEventLoopDelay } = require('perf_hooks');

const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const CFG = {
  perMinute: num(process.env.WEB_RATE_PER_MIN, 240), // dynamic requests per address per minute
  heavyPerMinute: num(process.env.WEB_RATE_HEAVY_PER_MIN, 90), // public pages that are expensive to build
  maxInFlight: num(process.env.WEB_MAX_INFLIGHT, 16), // pages being built at once for anonymous visitors (×3 for the signed-in)
  maxLagMs: num(process.env.WEB_MAX_LAG_MS, 300), // event loop lag after which new anonymous requests wait outside
  cacheMs: process.env.WEB_MICROCACHE_MS === undefined ? 5000 : Number(process.env.WEB_MICROCACHE_MS) || 0
};
const HEAVY = /^\/(communities|top)(\/|$)/;
const CACHEABLE = /^\/(|terms|privacy|communities|communities\/\d+|top\/\d+(\/[a-z]+)?)$/;
const SESSION_COOKIE = /(?:^|;\s*)connect\.sid=([^;]+)/;
// «signed in» only with a session cookie that really carries the panel's signature: a forged cookie is cheap to send
// and would otherwise skip the cache and get the larger share of the panel
function hasSession(req) {
  const m = SESSION_COOKIE.exec(req.headers.cookie || '');
  if (!m) return false;
  let v; try { v = decodeURIComponent(m[1]); } catch { return false; }
  if (!v.startsWith('s:')) return false;
  return require('cookie-signature').unsign(v.slice(2), process.env.SESSION_SECRET || 'not-configured') !== false;
}

// ---- 1. per address: a fixed window per minute (cheap, enough with nginx in front) ----
const windows = new Map(); // ip → { n, heavy, reset }
let sweepAt = 0;
function overLimit(ip, heavy, t) {
  if (t > sweepAt) { for (const [k, v] of windows) if (v.reset <= t) windows.delete(k); sweepAt = t + 60000; }
  let w = windows.get(ip);
  if (!w || w.reset <= t) { w = { n: 0, heavy: 0, reset: t + 60000 }; windows.set(ip, w); }
  w.n++; if (heavy) w.heavy++;
  if (w.n > CFG.perMinute || (heavy && w.heavy > CFG.heavyPerMinute)) return Math.ceil((w.reset - t) / 1000);
  return 0;
}

// ---- 2. shedding ----
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
let lagMs = 0;
setInterval(() => { lagMs = lag.percentile(99) / 1e6; lag.reset(); }, 1000).unref();
let inFlight = 0;

// ---- 3. micro-cache ----
const cache = new Map(); // key → { at, body, type }
// only the parameters the pages read: random ones added to dodge the cache all land on the same entry
const PARAMS = ['q', 'category', 'sort', 'page', 'tag', 'size', 'min', 'rpage'];
function cacheKey(req, res) {
  const q = PARAMS.filter((k) => req.query[k] !== undefined).map((k) => `${k}=${String(req.query[k]).slice(0, 60)}`).join('&');
  return `${res.locals.lang || ''}|${req.path}?${q}`;
}

function busy(res, seconds, text) {
  res.set({ 'Retry-After': String(seconds), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  return res.status(res.statusCode === 200 ? 503 : res.statusCode).end(text);
}

function shield(req, res, next) {
  if (req.path === '/healthz') return next(); // the outside monitor must see the truth, not a «busy»
  const t = Date.now();
  const signedIn = hasSession(req);
  const wait = overLimit(req.ip || 'unknown', req.method === 'GET' && HEAVY.test(req.path), t);
  if (wait) { res.status(429); return busy(res, wait, 'Слишком много запросов с вашего адреса. Подождите минуту. / Too many requests, wait a minute.'); }

  const anonGet = req.method === 'GET' && !signedIn && CFG.cacheMs > 0 && CACHEABLE.test(req.path);
  if (anonGet) {
    const hit = cache.get(cacheKey(req, res));
    if (hit && t - hit.at < CFG.cacheMs) {
      res.set({ 'Content-Type': hit.type, 'X-Cache': 'HIT' });
      return res.status(200).send(hit.body);
    }
  }
  // the signed-in are let through a bit longer: they are the server's admins at work
  if (inFlight >= CFG.maxInFlight * (signedIn ? 3 : 1) || (!signedIn && lagMs > CFG.maxLagMs)) {
    return busy(res, 5, 'Сайт сейчас перегружен. Обновите страницу через несколько секунд. / The site is busy, try again in a few seconds.');
  }
  inFlight++;
  let done = false;
  const finish = () => { if (!done) { done = true; inFlight--; } };
  res.on('finish', finish); res.on('close', finish);
  if (anonGet) {
    const send = res.send.bind(res);
    res.send = (body) => {
      if (res.statusCode === 200 && typeof body === 'string' && body.length < 600000 && !res.get('Set-Cookie')) {
        if (cache.size > 300) cache.delete(cache.keys().next().value);
        cache.set(cacheKey(req, res), { at: Date.now(), body, type: res.get('Content-Type') || 'text/html; charset=utf-8' });
      }
      return send(body);
    };
  }
  next();
}

shield.stats = () => ({ inFlight, lagMs, cached: cache.size, tracked: windows.size });
shield.reset = () => { windows.clear(); cache.clear(); inFlight = 0; lagMs = 0; };
shield.CFG = CFG;
module.exports = shield;
