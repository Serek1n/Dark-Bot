// Interactive messages switch, reaction roles v2 (several roles, modes), reports v2 settings.
// New tables (interactive_messages, voice_roles, temp_roles, reports) are created by sync().
const COLUMNS = [
  { table: 'guild_settings', column: 'interactiveEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'voiceRolesEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'reportDailyLimit', ddl: 'INTEGER DEFAULT 5' },
  { table: 'guild_settings', column: 'reportJoinAlert', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'reaction_roles', column: 'extraRoleIds', ddl: 'TEXT' },
  { table: 'reaction_roles', column: 'mode', ddl: "VARCHAR(255) NOT NULL DEFAULT 'normal'" }
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

module.exports = { name: '0011_lacuna_features', up };
