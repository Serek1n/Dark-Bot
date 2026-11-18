// The own text of the «achievement unlocked» message, and the «Статистика сервера» module (counters in channel names).
// The table of daily numbers (guild_stat_days) is new, so sequelize.sync() creates it.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(guild_settings);');
  if (!cols.length) return;
  for (const name of ['achievementsMessage', 'achievementsEmbedData', 'achievementsMsgOptions', 'serverStats']) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE guild_settings ADD COLUMN ${name} TEXT;`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
  if (!cols.some((c) => c.name === 'serverStatsEnabled')) {
    await sequelize.query('ALTER TABLE guild_settings ADD COLUMN serverStatsEnabled TINYINT(1) DEFAULT 1;').catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

module.exports = { name: '0030_achievement_text_stats', up };
