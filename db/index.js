const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/dark.sqlite';
const absPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absPath), { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: absPath,
  logging: false,
  // SQLite is a single file, not a network server — a connection pool just means
  // several separate handles fighting over the same file lock. One connection
  // avoids that entirely and is the standard recommendation for Sequelize+SQLite.
  pool: { max: 1, min: 0, idle: 10000 },
  retry: { max: 3, match: [/SQLITE_BUSY/i] }
});

const modelsDir = path.join(__dirname, 'models');
const models = {};

fs.readdirSync(modelsDir)
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    const define = require(path.join(modelsDir, file));
    const model = define(sequelize);
    models[model.name] = model;
  });

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(models);
});

// sync() never alters existing tables, so columns added in later versions are added here.
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
  { table: 'guild_settings', column: 'shopEnabled', ddl: 'TINYINT(1) DEFAULT 1' },
  { table: 'guild_settings', column: 'shopLogChannelId', ddl: 'VARCHAR(255)' },
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

async function addMissingColumns() {
  for (const { table, column, ddl } of COLUMN_ADDITIONS) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    // The bot and the web panel start at the same time: ignore "duplicate column" from the loser.
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

// Levels used to be a single track. Everything earned so far is counted as "chat" progress
// (it cannot be split afterwards); the total stays equal to chat + voice.
async function migrateTracks() {
  await sequelize.query('UPDATE member_profiles SET chatXp = xp, chatLevel = level WHERE chatXp = 0 AND voiceXp = 0 AND xp > 0;');

  // Level roles are unique per (guild, track, level) now, no longer per (guild, level).
  const [indexes] = await sequelize.query('PRAGMA index_list(level_roles);');
  for (const idx of indexes) {
    if (!idx.unique || idx.origin !== 'c') continue;
    const [info] = await sequelize.query(`PRAGMA index_info("${idx.name}");`);
    const columns = info.map((c) => c.name).sort().join(',');
    if (columns === 'guildId,level') await sequelize.query(`DROP INDEX IF EXISTS "${idx.name}";`);
  }
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS level_roles_guild_track_level ON level_roles (guildId, track, level);');
}

// Cases written before numbering existed get numbers 1, 2, 3... in the order they happened.
// Runs only for servers that have no numbered case yet, so it is safe to repeat.
async function backfillCaseNumbers() {
  await sequelize.query(
    `UPDATE mod_logs SET caseNumber = (SELECT COUNT(*) FROM mod_logs m2 WHERE m2.guildId = mod_logs.guildId AND m2.id <= mod_logs.id)
     WHERE caseNumber IS NULL AND NOT EXISTS (SELECT 1 FROM mod_logs x WHERE x.guildId = mod_logs.guildId AND x.caseNumber IS NOT NULL);`
  );
}

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

async function ensureIndexes() {
  for (const [name, table, cols] of INDEXES) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`).catch(() => {});
  }
  await sequelize.query('PRAGMA optimize;').catch(() => {});
}

async function init() {
  // SQLite locks the whole file for writes in its default journal mode. Two
  // findOrCreate calls firing together (e.g. via Promise.all when a brand-new
  // user's profile and a brand-new guild's settings are both created on first
  // use) can race and throw SQLITE_BUSY instead of just waiting their turn.
  // WAL mode lets reads and a write coexist, and busy_timeout makes any
  // remaining lock contention retry for up to 5s instead of failing instantly.
  await sequelize.query('PRAGMA journal_mode = WAL;');
  await sequelize.query('PRAGMA busy_timeout = 5000;');
  // In WAL mode NORMAL is safe against crashes of the program (only a power cut can lose the last
  // moments) and avoids an fsync on every write; the rest keeps hot data in memory.
  await sequelize.query('PRAGMA synchronous = NORMAL;');
  await sequelize.query('PRAGMA cache_size = -32000;'); // ~32 MB page cache
  await sequelize.query('PRAGMA temp_store = MEMORY;');
  await sequelize.query('PRAGMA mmap_size = 134217728;');
  await sequelize.sync(); // creates tables if they don't exist
  await addMissingColumns();
  await backfillCaseNumbers();
  await migrateTracks();
  await ensureIndexes();
}

module.exports = { sequelize, init, ...models };
