// The starboard settings ("Доска почёта"). The table of entries is created by sync().
const COLUMNS = [
  { table: 'guild_settings', column: 'starboardEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'starboardChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'starboardEmoji', ddl: "VARCHAR(255) DEFAULT '⭐'" },
  { table: 'guild_settings', column: 'starboardThreshold', ddl: 'INTEGER DEFAULT 3' },
  { table: 'guild_settings', column: 'starboardSelfStar', ddl: 'TINYINT(1) DEFAULT 0' }
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

module.exports = { name: '0008_starboard', up };
