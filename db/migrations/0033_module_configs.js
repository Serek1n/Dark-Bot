// Stage 3 of the panel: the settings of tickets, polls, mini-games, reminders and the bot's branding (JSON columns, see
// bot/utils/moduleConfig.js), where each module works (moduleScope); tickets get their topic, the answers of the form,
// the last activity (auto-close), a rating and the transcript; polls get anonymous button votes.
async function addColumns(sequelize, table, list) {
  const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
  if (!cols.length) return;
  for (const [name, type] of list) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`).catch((err) => { if (!/duplicate column/i.test(String(err.message))) throw err; });
  }
}
async function up({ sequelize }) {
  await addColumns(sequelize, 'guild_settings', [['ticketConfig', "TEXT DEFAULT '{}'"], ['pollConfig', "TEXT DEFAULT '{}'"], ['funConfig', "TEXT DEFAULT '{}'"],
    ['reminderConfig', "TEXT DEFAULT '{}'"], ['brandConfig', "TEXT DEFAULT '{}'"], ['moduleScope', "TEXT DEFAULT '{}'"]]);
  await addColumns(sequelize, 'tickets', [['category', 'VARCHAR(255)'], ['answers', 'TEXT'], ['lastActivityAt', 'DATETIME'], ['warnedAt', 'DATETIME'],
    ['rating', 'INTEGER'], ['transcript', 'TEXT'], ['closeReason', 'VARCHAR(255)']]);
  await addColumns(sequelize, 'polls', [['anonymous', 'BOOLEAN DEFAULT 0'], ['multi', 'BOOLEAN DEFAULT 1'], ['votes', 'TEXT'], ['authorId', 'VARCHAR(255)']]);
}

module.exports = { name: '0033_module_configs', up };
