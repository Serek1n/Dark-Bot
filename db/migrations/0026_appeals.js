// Appeals: the switch, where moderators hear about new ones, how many open appeals one person may have on a server, the
// pause after a refusal, whether links may be attached. The tables appeals and appeal_notes are created by sequelize.sync.
async function up({ sequelize }) {
  const addTo = async (table, name, def) => {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await addTo('guild_settings', 'appealsEnabled', 'TINYINT(1) DEFAULT 1');
  await addTo('guild_settings', 'appealsChannelId', 'VARCHAR(255)');
  await addTo('guild_settings', 'appealsMaxOpen', 'INTEGER DEFAULT 2');
  await addTo('guild_settings', 'appealsCooldownDays', 'INTEGER DEFAULT 7');
  await addTo('guild_settings', 'appealsLinks', 'TINYINT(1) DEFAULT 1');
  await addTo('guild_settings', 'appealsKinds', "VARCHAR(255) DEFAULT 'ban,mute,warn'");
}

module.exports = { name: '0026_appeals', up };
