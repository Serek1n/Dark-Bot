// "Наказания" (/mod) and "Логи сервера" can be switched off in the panel like the other modules. Both start on.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  const add = async (name, def) => {
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE guild_settings ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await add('moderationEnabled', 'TINYINT(1) DEFAULT 1');
  await add('logsEnabled', 'TINYINT(1) DEFAULT 1');
}

module.exports = { name: '0019_moderation_logs_switch', up };
