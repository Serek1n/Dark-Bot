// Message editor (embeds for welcome, farewell, level-up, custom commands), per-filter automod settings and name checks,
// several "join to create" voice channels.
const COLUMNS = [
  { table: 'guild_settings', column: 'welcomeEmbed', ddl: 'TEXT' },
  { table: 'guild_settings', column: 'leaveEmbed', ddl: 'TEXT' },
  { table: 'guild_settings', column: 'levelUpEmbedData', ddl: 'TEXT' },
  { table: 'guild_settings', column: 'automodRules', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'automodNicknames', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'automodDehoist', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'automodNickReplacement', ddl: "VARCHAR(255) DEFAULT 'Ник скрыт'" },
  { table: 'guild_settings', column: 'tempVoiceUserLimit', ddl: 'INTEGER DEFAULT 0' },
  { table: 'guild_settings', column: 'tempVoiceTriggers', ddl: "TEXT DEFAULT '[]'" },
  { table: 'custom_commands', column: 'embed', ddl: 'TEXT' }
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

module.exports = { name: '0013_editor_automod_voice', up };
