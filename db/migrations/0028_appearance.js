// «Оформление»: one JSON column with the server's theme and how each kind of message looks (bot/modules/appearance.js).
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (!cols.length || cols.some((c) => c.name === 'appearance')) return;
  await sequelize.query("ALTER TABLE guild_settings ADD COLUMN appearance TEXT DEFAULT '{}';").catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
}

module.exports = { name: '0028_appearance', up };
