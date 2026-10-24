// New option: an automatic punishment for warnings is applied only if the moderator who gave the warning could give that punishment himself.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (cols.some((c) => c.name === 'modEscalateNeedsPerm')) return;
  // With the panel in a separate process both may run this at once: "duplicate column" from the second is fine.
  await sequelize.query('ALTER TABLE guild_settings ADD COLUMN modEscalateNeedsPerm TINYINT(1) DEFAULT 0;').catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
}

module.exports = { name: '0004_escalation_needs_permission', up };
