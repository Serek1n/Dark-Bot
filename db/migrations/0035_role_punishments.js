// Stage 5: punishments by roles (role_punishments and case_notes are new tables: sequelize.sync() creates them),
// warnings with points and their own expiry, temporary roles tied to a case, the moderation settings as JSON.
async function addColumns(sequelize, table, list) {
  const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
  if (!cols.length) return;
  for (const [name, type] of list) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`).catch((err) => { if (!/duplicate column/i.test(String(err.message))) throw err; });
  }
}
async function up({ sequelize }) {
  await addColumns(sequelize, 'warnings', [['points', 'INTEGER DEFAULT 1'], ['expiresAt', 'DATETIME']]);
  await addColumns(sequelize, 'temp_roles', [['reason', 'VARCHAR(255)'], ['caseNumber', 'INTEGER']]);
  await addColumns(sequelize, 'guild_settings', [['modConfig', "TEXT DEFAULT '{}'"]]);
}

module.exports = { name: '0035_role_punishments', up };
