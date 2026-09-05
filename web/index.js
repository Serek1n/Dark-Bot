require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('./passport');
const { init } = require('../db');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const logger = require('../bot/utils/logger');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ dir: path.join(__dirname, '..', 'data'), db: 'sessions.sqlite' }),
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

app.get('/', (req, res) => res.render('login'));
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);

app.use((req, res) => res.status(404).render('error', { message: 'Страница не найдена.' }));
app.use((err, req, res, next) => {
  logger.error('Web error:', err);
  res.status(500).render('error', { message: 'Внутренняя ошибка сервера.' });
});

async function main() {
  await init();
  const port = process.env.WEB_PORT || 3000;
  app.listen(port, () => logger.info(`Веб-панель запущена: http://localhost:${port}`));
}

main();
