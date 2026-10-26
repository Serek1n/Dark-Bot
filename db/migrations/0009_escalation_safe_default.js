// An automatic kick or ban for warnings now happens only if the moderator who warned may kick or ban himself:
// otherwise someone allowed only to warn could get a member banned by the bot's rights. Switched on for every server.
async function up({ sequelize }) {
  await sequelize.query('UPDATE guild_settings SET modEscalateNeedsPerm = 1 WHERE modEscalateNeedsPerm IS NULL OR modEscalateNeedsPerm = 0;');
}

module.exports = { name: '0009_escalation_safe_default', up };
