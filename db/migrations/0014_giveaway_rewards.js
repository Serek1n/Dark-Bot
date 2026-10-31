// Giveaways that pay out by themselves: coins, crystals or a role (for a while or for good).
const COLUMNS = [
  { table: 'giveaways', column: 'rewardType', ddl: 'VARCHAR(255)' },
  { table: 'giveaways', column: 'rewardAmount', ddl: 'INTEGER' },
  { table: 'giveaways', column: 'rewardRoleId', ddl: 'VARCHAR(255)' },
  { table: 'giveaways', column: 'rewardSeconds', ddl: 'INTEGER' },
  { table: 'giveaways', column: 'rewarded', ddl: "TEXT DEFAULT '[]'" }
];

async function up({ sequelize }) {
  for (const { table, column, ddl } of COLUMNS) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) continue;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

module.exports = { name: '0014_giveaway_rewards', up };
