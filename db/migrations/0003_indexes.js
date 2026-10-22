// Indexes for what the panel and /top sort and count by, and for per-member lookups.
const INDEXES = [
  ['member_profiles_guild_xp', 'member_profiles', 'guildId, xp'],
  ['member_profiles_guild_voice', 'member_profiles', 'guildId, voiceSeconds'],
  ['member_profiles_guild_balance', 'member_profiles', 'guildId, balance'],
  ['mod_logs_guild_created', 'mod_logs', 'guildId, createdAt'],
  ['mod_logs_guild_user', 'mod_logs', 'guildId, userId'],
  ['warnings_guild_user', 'warnings', 'guildId, userId'],
  ['mod_logs_guild_case', 'mod_logs', 'guildId, caseNumber'],
  ['mod_logs_due', 'mod_logs', 'active, expiresAt'],
  ['member_profiles_guild_chat', 'member_profiles', 'guildId, chatXp'],
  ['member_profiles_guild_voicexp', 'member_profiles', 'guildId, voiceXp'],
  ['temp_voice_guild_owner', 'temp_voice_channels', 'guildId, ownerId'],
  ['level_roles_guild', 'level_roles', 'guildId']
];

async function up({ sequelize }) {
  for (const [name, table, cols] of INDEXES) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`).catch(() => {});
  }
}


module.exports = { name: '0003_indexes', up };
