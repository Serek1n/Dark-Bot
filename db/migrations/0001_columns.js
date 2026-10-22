// Columns added to existing tables in versions before migrations existed. Safe to run on any database (each column is added only if missing).
const COLUMN_ADDITIONS = [
  { table: 'member_profiles', column: 'voiceSeconds', ddl: 'BIGINT DEFAULT 0' },
  { table: 'member_profiles', column: 'chatXp', ddl: 'BIGINT DEFAULT 0' },
  { table: 'member_profiles', column: 'chatLevel', ddl: 'INTEGER DEFAULT 0' },
  { table: 'member_profiles', column: 'voiceXp', ddl: 'BIGINT DEFAULT 0' },
  { table: 'member_profiles', column: 'voiceLevel', ddl: 'INTEGER DEFAULT 0' },
  { table: 'member_profiles', column: 'crystals', ddl: 'BIGINT DEFAULT 0' },
  { table: 'level_roles', column: 'track', ddl: "VARCHAR(255) NOT NULL DEFAULT 'total'" },
  { table: 'guild_settings', column: 'voiceXpPerMinute', ddl: 'INTEGER DEFAULT 10' },
  { table: 'guild_settings', column: 'voiceMinMembers', ddl: 'INTEGER DEFAULT 2' },
  { table: 'guild_settings', column: 'voiceSkipMuted', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'levelRolesReplace', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'chatEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'voiceEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'crystalName', ddl: "VARCHAR(255) DEFAULT 'кристаллы'" },
  { table: 'guild_settings', column: 'chatCoinsPerMessage', ddl: 'INTEGER DEFAULT 5' },
  { table: 'guild_settings', column: 'voiceCoinsPerMinute', ddl: 'INTEGER DEFAULT 5' },
  { table: 'guild_settings', column: 'dailyCoins', ddl: 'INTEGER DEFAULT 100' },
  { table: 'guild_settings', column: 'shopEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'shopLogChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'crystalsPerLevel', ddl: 'INTEGER DEFAULT 1' },
  { table: 'member_profiles', column: 'dailyStreak', ddl: 'INTEGER DEFAULT 0' },
  { table: 'guild_settings', column: 'dailyStreakBonus', ddl: 'INTEGER DEFAULT 10' },
  { table: 'guild_settings', column: 'dailyStreakMax', ddl: 'INTEGER DEFAULT 7' },
  ...['economyEnabled', 'musicEnabled', 'welcomeEnabled', 'reactionRolesEnabled', 'customCommandsEnabled', 'tempVoiceEnabled', 'alertsEnabled', 'reportEnabled'].map((column) => ({ table: 'guild_settings', column, ddl: 'TINYINT(1) DEFAULT 1' })),
  { table: 'guild_settings', column: 'leftAt', ddl: 'DATETIME' },
  { table: 'guild_settings', column: 'logForumChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'logWebhookId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'logWebhookToken', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'logThreads', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'logDisabled', ddl: "TEXT DEFAULT '[]'" },
  { table: 'guild_settings', column: 'automodAction', ddl: "VARCHAR(255) DEFAULT 'delete'" },
  { table: 'guild_settings', column: 'automodMuteMinutes', ddl: "INTEGER DEFAULT 10" },
  { table: 'guild_settings', column: 'automodMentionLimit', ddl: "INTEGER DEFAULT 0" },
  { table: 'guild_settings', column: 'automodCapsPercent', ddl: "INTEGER DEFAULT 0" },
  { table: 'guild_settings', column: 'automodCapsMinLength', ddl: "INTEGER DEFAULT 10" },
  { table: 'guild_settings', column: 'automodBlockLinks', ddl: "TINYINT(1) DEFAULT 0" },
  { table: 'guild_settings', column: 'automodLinkWhitelist', ddl: "TEXT DEFAULT '[]'" },
  { table: 'guild_settings', column: 'automodEmojiLimit', ddl: "INTEGER DEFAULT 0" },
  { table: 'guild_settings', column: 'automodDuplicates', ddl: "TINYINT(1) DEFAULT 0" },
  { table: 'guild_settings', column: 'automodIgnoredChannels', ddl: "TEXT DEFAULT '[]'" },
  { table: 'guild_settings', column: 'automodIgnoredRoles', ddl: "TEXT DEFAULT '[]'" },
  { table: 'guild_settings', column: 'modDmEnabled', ddl: "TINYINT(1) DEFAULT 1" },
  { table: 'guild_settings', column: 'modRequireReason', ddl: "TINYINT(1) DEFAULT 0" },
  { table: 'guild_settings', column: 'modWarnExpireDays', ddl: "INTEGER DEFAULT 0" },
  { table: 'guild_settings', column: 'modWarnThresholds', ddl: "TEXT DEFAULT '[]'" },
  { table: 'guild_settings', column: 'levelUpInVoice', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'channelBoosts', ddl: "TEXT DEFAULT '{}'" },
  { table: 'guild_settings', column: 'automodProfanity', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'automodZalgo', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'welcomeCard', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'leaveChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'leaveMessage', ddl: "VARCHAR(255) DEFAULT '**{user}** покинул(а) сервер. Нас осталось {count}.'" },
  { table: 'guild_settings', column: 'pollsEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'giveawaysEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'ticketsEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'remindersEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'webhooksEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'restoreOnRejoin', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'restoreDays', ddl: 'INTEGER DEFAULT 365' },
  { table: 'guild_settings', column: 'restoreStaffRoles', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'member_snapshots', column: 'mutedUntil', ddl: 'DATETIME' },
  { table: 'temp_voice_channels', column: 'access', ddl: "VARCHAR(255) NOT NULL DEFAULT 'open'" },
  { table: 'temp_voice_channels', column: 'lockState', ddl: "TEXT NOT NULL DEFAULT '{}'" },
  { table: 'guild_settings', column: 'tempVoicePanelChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'tempVoicePanelMessageId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'betaEnabled', ddl: 'TINYINT(1) DEFAULT 0' },
  { table: 'guild_settings', column: 'webhookPanelChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'webhookPanelMessageId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'funEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'ticketCategoryId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'ticketSupportRoleId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'ticketLogChannelId', ddl: 'VARCHAR(255)' },
  { table: 'guild_settings', column: 'ticketMessage', ddl: "VARCHAR(255) DEFAULT 'Опишите вашу проблему, и скоро вам ответит команда сервера.'" },
  { table: 'mod_logs', column: 'caseNumber', ddl: "INTEGER" },
  { table: 'mod_logs', column: 'duration', ddl: "BIGINT" },
  { table: 'mod_logs', column: 'expiresAt', ddl: "DATETIME" },
  { table: 'mod_logs', column: 'active', ddl: "TINYINT(1) DEFAULT 0" }
];

async function up({ sequelize }) {
  for (const { table, column, ddl } of COLUMN_ADDITIONS) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    // The bot and the web panel start at the same time: ignore "duplicate column" from the loser.
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}


module.exports = { name: '0001_columns', up };
