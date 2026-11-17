// Achievements: the switch, where the cards go, the built-in ones a server turned off, the balance goal.
// The tables achievements and member_achievements are new: sequelize.sync creates them.
async function up({ sequelize }) {
  const addTo = async (table, name, def) => {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await addTo('guild_settings', 'achievementsEnabled', 'TINYINT(1) DEFAULT 1');
  await addTo('guild_settings', 'achievementsNotify', "VARCHAR(255) DEFAULT 'auto'");
  await addTo('guild_settings', 'achievementsChannelId', 'VARCHAR(255)');
  await addTo('guild_settings', 'achievementsOff', "TEXT DEFAULT '[]'");
  await addTo('guild_settings', 'achievementsBalanceGoal', 'INTEGER DEFAULT 10000');
}

module.exports = { name: '0025_achievements', up };
