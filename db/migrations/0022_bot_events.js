// "События бота" becomes a module of its own: a switch, and the settings of what the bot announces and where
// (JSON: which events, a channel for each, how switching sections on is announced). Starts on.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  const add = async (name, def) => {
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE guild_settings ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await add('botEventsEnabled', 'TINYINT(1) DEFAULT 1');
  await add('botEvents', "TEXT DEFAULT '{}'");
}

module.exports = { name: '0022_bot_events', up };
