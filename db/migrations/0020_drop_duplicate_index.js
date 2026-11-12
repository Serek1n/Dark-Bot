// mod_logs had two indexes on (guildId, caseNumber): the plain one and, since 0018, the unique one. Where the unique one
// exists it serves every lookup the plain one did, so the plain one only made each new case slower to write.
async function up({ sequelize }) {
  const [rows] = await sequelize.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mod_logs';");
  const names = rows.map((r) => r.name);
  if (names.includes('mod_logs_guild_case_unique') && names.includes('mod_logs_guild_case')) {
    await sequelize.query('DROP INDEX IF EXISTS mod_logs_guild_case;');
  }
}

module.exports = { name: '0020_drop_duplicate_index', up };
