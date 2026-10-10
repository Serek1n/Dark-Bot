require('dotenv').config();
const path = require('path');
const express = require('express');
require('express-async-errors'); // patches Express 4 so rejected promises in route handlers reach the error middleware instead of crashing the process
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('./passport');
const { init } = require('../db');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const logger = require('../bot/utils/logger');

const app = express();
app.set('trust proxy', 1); // needed behind nginx so secure cookies and req.protocol work correctly

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Basic hardening headers. The panel loads only its own assets plus Discord's CDN for avatars.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; form-action 'self'"
  });
  next();
});

// CSRF guard: state-changing requests must come from this site (browsers always send Origin on
// cross-site POSTs; same-origin form posts send either Origin or a same-host Referer).
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    if (new URL(source).host === req.get('host')) return next();
  } catch (_) { /* fall through */ }
  return res.status(403).render('error', { message: 'Запрос отклонён: он отправлен с другого сайта.' });
});

const isHttps = (process.env.WEB_BASE_URL || '').startsWith('https://');

app.use(
  session({
    store: new SQLiteStore({ dir: path.join(__dirname, '..', 'data'), db: 'sessions.sqlite' }),
    secret: process.env.SESSION_SECRET || 'change-me',
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
  next();
});

app.get('/', (req, res) => res.render('login'));
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);

app.use((req, res, next) => res.status(404).render('error', { message: 'Страница не найдена.' }));
app.use((err, req, res, next) => {
  logger.error('Web error:', err);
  const isDiscordApiError = err.isAxiosError || err.response?.status;
  const message = isDiscordApiError
    ? 'Не удалось получить данные от Discord (сервис временно недоступен или истёк токен бота). Попробуйте обновить страницу через минуту.'
    : 'Внутренняя ошибка сервера.';
  res.status(500).render('error', { message });
});

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') {
  logger.warn('SESSION_SECRET не задан — сессии небезопасны. Укажите длинную случайную строку в .env.');
}

async function main() {
  await init();
  const port = process.env.WEB_PORT || 3000;
  app.listen(port, () => logger.info(`Веб-панель запущена: http://localhost:${port}`));
}

main();
