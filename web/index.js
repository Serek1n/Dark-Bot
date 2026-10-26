require('dotenv').config();
const path = require('path');
const express = require('express');
require('express-async-errors'); // patches Express 4 so rejected promises in route handlers reach the error middleware instead of crashing the process
const session = require('express-session');
const { SequelizeStore } = require('./sessionStore');
const passport = require('./passport');
const { init } = require('../db');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const legalRoutes = require('./routes/legal');
const logger = require('../bot/utils/logger');
const { csrfGuard } = require('./middleware/csrf');
const { rateLimit } = require('./middleware/rateLimit');
const { panelAudit } = require('./middleware/panelAudit');
const { requireSessionSecret } = require('./security');

const app = express();
app.set('trust proxy', 1); // needed behind nginx so secure cookies and req.protocol work correctly

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Cache-busting for CSS: the stylesheet URL carries the file's modification time, so a browser
// that cached an old version (static files are cached for a week) fetches the new one right
// after an update instead of showing a half-styled page.
const fs = require('fs');
function assetVersion() {
  let newest = 0;
  for (const f of ['css/style.css', 'css/fonts.css', 'js/theme.js', 'js/ui.js', 'js/public-top.js']) {
    try {
      newest = Math.max(newest, fs.statSync(path.join(__dirname, 'public', f)).mtimeMs);
    } catch (_) { /* missing file: ignore */ }
  }
  return Math.floor(newest).toString(36);
}
app.locals.assetV = assetVersion();
app.locals.betaBuild = require('../bot/utils/channel').isBetaBuild(); // the beta build shows a tag next to the name
app.locals.betaPages = require('../bot/utils/features').betaPages; // menu items of features still in testing
app.locals.errorTexts = require('../bot/utils/discordErrors').ERROR_TEXT; // texts for error codes carried in links

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  setHeaders: (res, file) => { if (file.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } // fonts never change under the same name
}));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Basic hardening headers. The panel loads only its own assets plus Discord's CDN for avatars.
const httpsSite = (process.env.WEB_BASE_URL || '').startsWith('https://');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  if (httpsSite) res.set('Strict-Transport-Security', 'max-age=31536000'); // the browser stays on https for a year
  // Pages of the panel hold private data (webhook links, member lists): never kept in a shared or browser cache, never shown by "Back" after logout.
  if (req.path.startsWith('/dashboard') || req.path.startsWith('/auth')) res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  next();
});

app.use(csrfGuard);
app.use(panelAudit);

const isHttps = httpsSite;

app.use(
  session({
    store: new SequelizeStore(),
    secret: process.env.SESSION_SECRET || 'not-configured', // main() refuses to start without a real one
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3 * 24 * 60 * 60 * 1000, secure: isHttps, httpOnly: true, sameSite: 'lax' }
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.baseUrl = process.env.WEB_BASE_URL || '';
  // Versions of the bot and the panel, shown at the bottom of the side menu and on the overview page.
  const { systemInfo, buildLine } = require('./utils/systemInfo');
  res.locals.sys = systemInfo();
  res.locals.sysLine = buildLine(res.locals.sys);
  next();
});

app.get('/', (req, res) => res.render('login'));
app.use('/', legalRoutes); // public pages: /terms and /privacy (required by Discord for the app profile)
// Rate limits: sign-in attempts per address, and any change made in the panel per user.
const loginLimit = rateLimit({ windowMs: 10 * 60_000, max: 30, key: (req) => req.ip, message: 'Слишком много попыток входа. Подождите несколько минут.' });
const changeLimit = rateLimit({ windowMs: 60_000, max: 120 });
app.use('/auth/login', loginLimit);
app.use('/auth/callback', loginLimit);
app.use('/dashboard', (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : changeLimit(req, res, next)));
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/top', require('./routes/publicTop')); // public leaderboards (only where the admins switched them on)

app.use((req, res, next) => res.status(404).render('error', { message: 'Страница не найдена.' }));
app.use((err, req, res, next) => {
  // Form problems (too large, unreadable) are the visitor's, not the server's: say what happened with the right status.
  if (err.type === 'entity.too.large') return res.status(413).render('error', { message: 'Слишком много данных в форме. Сократите текст или список и попробуйте снова.' });
  if (err.status >= 400 && err.status < 500 && err.expose) return res.status(err.status).render('error', { message: 'Не удалось прочитать отправленную форму. Обновите страницу и повторите.' });
  logger.error('Web error:', err.isAxiosError ? `${err.message} (${err.response?.status || 'нет ответа'})` : err); // an axios error holds request URLs, which can contain webhook tokens
  const isDiscordApiError = err.isAxiosError || err.response?.status;
  const message = isDiscordApiError
    ? 'Не удалось получить данные от Discord (сервис временно недоступен или истёк токен бота). Попробуйте обновить страницу через минуту.'
    : 'Внутренняя ошибка сервера.';
  res.status(500).render('error', { message });
});

/**
 * Starts the panel. `client` is the bot's Discord client when the panel runs inside the bot's process (the normal way);
 * without it the panel works alone and asks Discord over REST. Returns the http server, or null if it could not start.
 */
async function start({ client = null, standalone = false } = {}) {
  try { requireSessionSecret(); } catch (err) {
    logger.error(err.message);
    if (standalone) process.exit(1);
    logger.error('Веб-панель не запущена (бот работает без неё).');
    return null;
  }
  // The database and session files hold tokens: keep them readable for this user only (best effort).
  {
    const dbFile = path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/dark.sqlite');
    const dataDir = path.join(__dirname, '..', 'data');
    const files = [dbFile, dbFile + '-wal', dbFile + '-shm', path.join(dataDir, 'sessions.sqlite')];
    try { fs.chmodSync(dataDir, 0o700); } catch (_) { /* not there or not allowed */ }
    for (const f of files) { try { fs.chmodSync(f, 0o600); } catch (_) { /* not there or not allowed */ } }
  }
  require('./botBridge').setClient(client);
  if (!client) await init(); // inside the bot the database is already prepared
  const port = process.env.WEB_PORT || 3000;
  return new Promise((resolve) => {
    // Only this machine by default: the panel is reached through nginx (HTTPS). Open to the network, it could be called
    // past nginx with a forged X-Forwarded-For (rate limits) and over plain HTTP. WEB_HOST=0.0.0.0 for Docker.
    const host = process.env.WEB_HOST || '127.0.0.1';
    const server = app.listen(port, host, () => {
      logger.info(`Веб-панель запущена: http://localhost:${port}${client ? ' (в одном процессе с ботом)' : ''}`);
      resolve(server);
    });
    server.on('error', (err) => {
      logger.error(`Веб-панель не запустилась на порту ${port}: ${err.message}`);
      if (standalone) process.exit(1);
      resolve(null); // the bot keeps working
    });
  });
}

if (require.main === module) start({ standalone: true });

module.exports = { app, start };
