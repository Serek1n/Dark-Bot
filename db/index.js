const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/dark.sqlite';
const absPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absPath), { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: absPath,
  logging: false,
  // SQLite is a single file, not a network server — a connection pool just means
  // several separate handles fighting over the same file lock. One connection
  // avoids that entirely and is the standard recommendation for Sequelize+SQLite.
  pool: { max: 1, min: 0, idle: 10000 },
  retry: { max: 3, match: [/SQLITE_BUSY/i] }
});

const modelsDir = path.join(__dirname, 'models');
const models = {};

fs.readdirSync(modelsDir)
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    const define = require(path.join(modelsDir, file));
    const model = define(sequelize);
    models[model.name] = model;
  });

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(models);
});

// sync() never alters existing tables, so columns added in later versions are added here.
async function addMissingColumns() {
  const additions = [{ table: 'member_profiles', column: 'voiceSeconds', ddl: 'BIGINT DEFAULT 0' },
    { table: 'guild_settings', column: 'voiceXpPerMinute', ddl: 'INTEGER DEFAULT 10' },
    { table: 'guild_settings', column: 'levelRolesReplace', ddl: 'TINYINT(1) DEFAULT 0' }];
  for (const { table, column, ddl } of additions) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    // The bot and the web panel start at the same time: ignore "duplicate column" from the loser.
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

async function init() {
  // SQLite locks the whole file for writes in its default journal mode. Two
  // findOrCreate calls firing together (e.g. via Promise.all when a brand-new
  // user's profile and a brand-new guild's settings are both created on first
  // use) can race and throw SQLITE_BUSY instead of just waiting their turn.
  // WAL mode lets reads and a write coexist, and busy_timeout makes any
  // remaining lock contention retry for up to 5s instead of failing instantly.
  await sequelize.query('PRAGMA journal_mode = WAL;');
  await sequelize.query('PRAGMA busy_timeout = 5000;');
  await sequelize.sync(); // creates tables if they don't exist
  await addMissingColumns();
}

module.exports = { sequelize, init, ...models };
