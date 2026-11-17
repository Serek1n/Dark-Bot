// Warnings keep their history: a removed warning is marked as revoked (who, when, why — also by an appeal) instead of
// being deleted, and the automatic punishment it triggered keeps its real outcome (applied / failed with the reason / ...).
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(warnings);');
  const add = async (name, def) => {
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE warnings ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await add('autoAction', 'TEXT');
  await add('revokedAt', 'DATETIME');
  await add('revokedBy', 'VARCHAR(255)');
  await add('revokeReason', 'VARCHAR(255)');
}

module.exports = { name: '0023_warning_status', up };
