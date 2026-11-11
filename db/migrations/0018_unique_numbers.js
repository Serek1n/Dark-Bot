// Case numbers and ticket numbers are "the biggest one + 1" under a lock in memory. The database now guards it too:
// one number per server. Where old data already holds a repeated number the index is not made (nothing is changed or lost).
async function up({ sequelize }) {
  const make = async (name, table, cols, where = '') => {
    const [dups] = await sequelize.query(`SELECT 1 FROM ${table} ${where} GROUP BY ${cols} HAVING COUNT(*) > 1 LIMIT 1;`);
    if (dups.length) return;
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table} (${cols}) ${where};`);
  };
  const tables = (await sequelize.query("SELECT name FROM sqlite_master WHERE type = 'table';"))[0].map((t) => t.name);
  if (tables.includes('mod_logs')) await make('mod_logs_guild_case_unique', 'mod_logs', 'guildId, caseNumber', 'WHERE caseNumber IS NOT NULL');
  if (tables.includes('tickets')) await make('tickets_guild_number_unique', 'tickets', 'guildId, number', 'WHERE number IS NOT NULL');
}

module.exports = { name: '0018_unique_numbers', up };
