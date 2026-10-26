// Indexes for the history lists (/mod history, warnings), the overview counts and the ticket sweep after a restart.
const INDEXES = [
  ['mod_logs_guild_user_created', 'mod_logs', 'guildId, userId, createdAt'],
  ['warnings_guild_user_created', 'warnings', 'guildId, userId, createdAt'],
  ['reaction_roles_guild', 'reaction_roles', 'guildId'],
  ['tickets_status_closed', 'tickets', 'status, closedAt']
];

async function up({ sequelize }) {
  for (const [name, table, cols] of INDEXES) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`).catch(() => {});
  }
  // the older two-column indexes are covered by the new ones
  await sequelize.query('DROP INDEX IF EXISTS mod_logs_guild_user;').catch(() => {});
  await sequelize.query('DROP INDEX IF EXISTS warnings_guild_user;').catch(() => {});
}

module.exports = { name: '0010_more_indexes', up };
