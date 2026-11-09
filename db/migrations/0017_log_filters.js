// What the server logs leave out: channels, roles and bots (panel → Логи сервера → «Что не записывать»).
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  const add = async (name, def) => {
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE guild_settings ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await add('logIgnoreChannels', "TEXT DEFAULT '[]'");
  await add('logIgnoreRoles', "TEXT DEFAULT '[]'");
  await add('logIgnoreBots', 'TINYINT(1) DEFAULT 0');
}

module.exports = { name: '0017_log_filters', up };
