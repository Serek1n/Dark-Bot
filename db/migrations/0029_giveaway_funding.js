// Giveaways paid from the server's treasury: where the prize money came from, and whether the part nobody won went back.
async function up({ sequelize }) {
  const addTo = async (table, name, def) => {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (!cols.length || cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await addTo('giveaways', 'rewardSource', 'VARCHAR(255)');
  await addTo('giveaways', 'refunded', 'TINYINT(1) DEFAULT 0');
}

module.exports = { name: '0029_giveaway_funding', up };
