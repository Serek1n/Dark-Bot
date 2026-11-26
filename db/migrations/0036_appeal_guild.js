// Stage 6: appeals in the bot's DMs and the appeal server (appeal_guild_passes is a new table: sequelize.sync() creates it).
async function addColumns(sequelize, table, list) {
  const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
  if (!cols.length) return;
  for (const [name, type] of list) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`).catch((err) => { if (!/duplicate column/i.test(String(err.message))) throw err; });
  }
}
async function up({ sequelize }) {
  await addColumns(sequelize, 'appeals', [['source', "VARCHAR(8) DEFAULT 'web'"]]);
  await addColumns(sequelize, 'guild_settings', [
    ['appealsDm', 'TINYINT(1) DEFAULT 1'], ['appealGuildId', 'VARCHAR(255)'], ['appealInviteChannelId', 'VARCHAR(255)'],
    ['appealGuildMode', "VARCHAR(10) DEFAULT 'off'"], ['appealGuildKinds', "VARCHAR(255) DEFAULT 'ban'"], ['appealInviteHours', 'INTEGER DEFAULT 48'],
    ['appealGuildRoleId', 'VARCHAR(255)'], ['appealGuildThread', 'TINYINT(1) DEFAULT 0'], ['appealGuildStrict', "VARCHAR(8) DEFAULT 'off'"], ['appealGuildKickOnDone', 'TINYINT(1) DEFAULT 1']
  ]);
}

module.exports = { name: '0036_appeal_guild', up };
