// «Базовые настройки»: the server's own time zone (null: Moscow, as before).
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (!cols.length || cols.some((c) => c.name === 'timezone')) return;
  await sequelize.query('ALTER TABLE guild_settings ADD COLUMN timezone VARCHAR(255);').catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
}

module.exports = { name: '0032_guild_timezone', up };
