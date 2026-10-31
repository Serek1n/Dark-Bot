// Shop roles for a limited time: the item keeps the term, the purchase keeps until when.
const COLUMNS = [
  { table: 'shop_items', column: 'durationSeconds', ddl: 'INTEGER' },
  { table: 'purchases', column: 'expiresAt', ddl: 'DATETIME' }
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

module.exports = { name: '0012_shop_duration', up };
