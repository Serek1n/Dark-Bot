// Schema changes live in db/migrations/NNNN_name.js (each exports { name, up({ sequelize }) }). They run once, in order, and are
// recorded in the table schema_migrations, so a changed database is never "fixed" by guessing. To change the schema later:
//   - add a column / index / data fix: create the next numbered file (never edit one that has already been released);
//   - add a NEW TABLE: just add the model, sync() creates it.
const fs = require('fs');
const path = require('path');
const { Umzug } = require('umzug');

const dir = path.join(__dirname, 'migrations');

const makeStorage = (sequelize) => ({
  async executed() {
    await sequelize.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, runAt DATETIME NOT NULL)');
    const [rows] = await sequelize.query('SELECT name FROM schema_migrations ORDER BY name');
    return rows.map((r) => r.name);
  },
  async logMigration({ name }) {
    await sequelize.query('INSERT OR IGNORE INTO schema_migrations (name, runAt) VALUES (?, ?)', { replacements: [name, new Date()] });
  },
  async unlogMigration({ name }) {
    await sequelize.query('DELETE FROM schema_migrations WHERE name = ?', { replacements: [name] });
  }
});

function loadMigrations(sequelize) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.js$/.test(f))
    .sort()
    .map((f) => require(path.join(dir, f)))
    .map((m) => ({ name: m.name, up: async () => m.up({ sequelize }) }));
}

async function runMigrations(sequelize) {
  const umzug = new Umzug({ migrations: loadMigrations(sequelize), context: sequelize, storage: makeStorage(sequelize), logger: undefined });
  return umzug.up();
}

module.exports = { runMigrations };
