// Where a server wants the "what's new" notes, and which release it has already been told about.
const COLUMNS = [
  { table: 'guild_settings', column: 'updatesChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'updatesLastPosted', ddl: 'VARCHAR(255)' }
];

async function up({ sequelize }) {
  for (const { table, column, ddl } of COLUMNS) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

module.exports = { name: '0007_update_notes', up };
