// Economy, first wave: modes and sections, events channel, treasury, the central bank's rate, goals' XP boost, seasons, /work.
// The new tables (economy_tx, economy_earn, economy_supply, economy_holds, economy_goals, economy_goal_contribs, economy_deals,
// economy_gifts, economy_badges) are created by sync().
const COLUMNS = [
  { table: 'guild_settings', column: 'economyMode', ddl: "VARCHAR(255) DEFAULT 'simple'" },
  { table: 'guild_settings', column: 'economyPreset', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'economyFeatures', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'economyParams', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'economyEventsChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'economyEventsMode', ddl: "VARCHAR(255) DEFAULT 'summary'" },
  { table: 'guild_settings', column: 'treasury', ddl: 'INTEGER DEFAULT 0' },
  { table: 'guild_settings', column: 'econRate', ddl: 'FLOAT DEFAULT 1' },
  { table: 'guild_settings', column: 'xpBoostUntil', ddl: 'DATETIME' },
  { table: 'guild_settings', column: 'xpBoostMult', ddl: 'FLOAT DEFAULT 1' },
  { table: 'guild_settings', column: 'seasonNumber', ddl: 'INTEGER DEFAULT 1' },
  { table: 'guild_settings', column: 'seasonStartedAt', ddl: 'DATETIME' },
  { table: 'member_profiles', column: 'lastWorkAt', ddl: 'DATETIME' },
  { table: 'polls', column: 'action', ddl: 'TEXT' }
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

module.exports = { name: '0021_economy_wave1', up };
