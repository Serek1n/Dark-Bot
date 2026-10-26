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

// Sequelize opens an extra connection for every transaction, and a PRAGMA only affects the connection it ran on. So the wait for a
// busy database (several writers: the bot, the web panel, parallel transactions) is set on EVERY connection as it opens.
const rawGetConnection = sequelize.connectionManager.getConnection.bind(sequelize.connectionManager);
const patched = new WeakSet();
sequelize.connectionManager.getConnection = async function getConnection(options) {
  const connection = await rawGetConnection(options);
  if (connection && !patched.has(connection)) {
    patched.add(connection);
    try { connection.configure('busyTimeout', 5000); } catch { /* not a sqlite3 handle */ }
    // The same speed settings as the main connection: without them every transaction's commit waits for a full fsync.
    try { connection.exec('PRAGMA synchronous = NORMAL; PRAGMA cache_size = -8000; PRAGMA temp_store = MEMORY;'); } catch { /* not a sqlite3 handle */ }
  }
  return connection;
};

// Transactions of this process run ONE AT A TIME. Sequelize gives each transaction its own connection, and several of them racing for
// SQLite's single write lock thrash (BEGIN fails with "database is locked" even with a wait). In a queue they are instant; against another
// process (the web panel) the busy timeout above still waits. Never call inTransaction from inside another inTransaction.
let txQueue = Promise.resolve();
function inTransaction(work) {
  const run = txQueue.then(() => sequelize.transaction({ type: 'IMMEDIATE' }, work));
  txQueue = run.catch(() => {});
  return run;
}

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

const { runMigrations } = require('./migrate');

async function init() {
  // SQLite locks the whole file for writes in its default journal mode. Two
  // findOrCreate calls firing together (e.g. via Promise.all when a brand-new
  // user's profile and a brand-new guild's settings are both created on first
  // use) can race and throw SQLITE_BUSY instead of just waiting their turn.
  // WAL mode lets reads and a write coexist, and busy_timeout makes any
  // remaining lock contention retry for up to 5s instead of failing instantly.
  await sequelize.query('PRAGMA journal_mode = WAL;');
  await sequelize.query('PRAGMA busy_timeout = 5000;');
  // In WAL mode NORMAL is safe against crashes of the program (only a power cut can lose the last
  // moments) and avoids an fsync on every write; the rest keeps hot data in memory.
  await sequelize.query('PRAGMA synchronous = NORMAL;');
  await sequelize.query('PRAGMA cache_size = -32000;'); // ~32 MB page cache
  await sequelize.query('PRAGMA temp_store = MEMORY;');
  await sequelize.query('PRAGMA mmap_size = 134217728;');
  await sequelize.sync(); // creates tables that don't exist yet (it never changes existing ones)
  await runMigrations(sequelize); // everything else: new columns, indexes, data fixes (db/migrations)
  await sequelize.query('PRAGMA optimize;').catch(() => {});
}

module.exports = { sequelize, init, inTransaction, ...models };
