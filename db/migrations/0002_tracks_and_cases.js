// Levels used to be a single track. Everything earned so far is counted as "chat" progress
// (it cannot be split afterwards); the total stays equal to chat + voice.
async function migrateTracks(sequelize) {
  await sequelize.query('UPDATE member_profiles SET chatXp = xp, chatLevel = level WHERE chatXp = 0 AND voiceXp = 0 AND xp > 0;');

  // Level roles are unique per (guild, track, level) now, no longer per (guild, level).
  const [indexes] = await sequelize.query('PRAGMA index_list(level_roles);');
  for (const idx of indexes) {
    if (!idx.unique || idx.origin !== 'c') continue;
    const [info] = await sequelize.query(`PRAGMA index_info("${idx.name}");`);
    const columns = info.map((c) => c.name).sort().join(',');
    if (columns === 'guildId,level') await sequelize.query(`DROP INDEX IF EXISTS "${idx.name}";`);
  }
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS level_roles_guild_track_level ON level_roles (guildId, track, level);');
}

// Cases written before numbering existed get numbers 1, 2, 3... in the order they happened.
// Runs only for servers that have no numbered case yet, so it is safe to repeat.
async function backfillCaseNumbers(sequelize) {
  await sequelize.query(
    `UPDATE mod_logs SET caseNumber = (SELECT COUNT(*) FROM mod_logs m2 WHERE m2.guildId = mod_logs.guildId AND m2.id <= mod_logs.id)
     WHERE caseNumber IS NULL AND NOT EXISTS (SELECT 1 FROM mod_logs x WHERE x.guildId = mod_logs.guildId AND x.caseNumber IS NOT NULL);`
  );
}


async function up({ sequelize }) {
  await migrateTracks(sequelize);
  await backfillCaseNumbers(sequelize);
}

module.exports = { name: '0002_tracks_and_cases', up };
