// Role multipliers, the level-up message settings, "keep" for level roles and the public leaderboard.
const COLUMNS = [
  { table: 'guild_settings', column: 'roleBoosts', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'roleBoostMode', ddl: "VARCHAR(255) DEFAULT 'largest'" },
  { table: 'guild_settings', column: 'boostStacking', ddl: "VARCHAR(255) DEFAULT 'multiply'" },
  { table: 'guild_settings', column: 'levelUpDestination', ddl: "VARCHAR(255) DEFAULT 'auto'" },
  { table: 'guild_settings', column: 'levelUpMessage', ddl: 'TEXT' },
  { table: 'guild_settings', column: 'levelUpEmbed', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'levelUpEvery', ddl: 'INTEGER DEFAULT 1' },
  { table: 'guild_settings', column: 'levelUpEveryUntil', ddl: 'INTEGER DEFAULT 0' },
  { table: 'guild_settings', column: 'levelUpRewardOnly', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'leaderboardPublic', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'leaderboardMinLevel', ddl: 'INTEGER DEFAULT 0' },
  { table: 'level_roles', column: 'keep', ddl: 'TINYINT(1) DEFAULT 0' }
];

async function up({ sequelize }) {
  for (const { table, column, ddl } of COLUMNS) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err; // two processes starting at once
    });
  }
}

module.exports = { name: '0006_polaris_features', up };
