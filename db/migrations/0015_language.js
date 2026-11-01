// The bot's language per server. Servers that already use the bot stay Russian; new ones follow their Discord language.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (cols.some((c) => c.name === 'language')) return;
  await sequelize.query("ALTER TABLE guild_settings ADD COLUMN language VARCHAR(255) DEFAULT 'auto';").catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
  await sequelize.query("UPDATE guild_settings SET language = 'ru';");
}

module.exports = { name: '0015_language', up };
