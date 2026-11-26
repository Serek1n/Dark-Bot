// Stage 4: access to the panel by roles (panel_role_access and panel_audit are new tables: sequelize.sync() creates
// them). The server keeps two choices: whether «Manage Server» alone still opens the whole panel (strict = no), and
// where the log of the panel's changes is posted.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (!cols.length) return;
  for (const [name, type] of [['panelStrict', 'BOOLEAN DEFAULT 0'], ['panelAuditChannelId', 'VARCHAR(255)']]) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE guild_settings ADD COLUMN ${name} ${type};`).catch((err) => { if (!/duplicate column/i.test(String(err.message))) throw err; });
  }
}

module.exports = { name: '0034_panel_access', up };
