// Shop items that each member may buy only once (trials).
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(shop_items);');
  if (cols.some((c) => c.name === 'oncePerUser')) return;
  await sequelize.query('ALTER TABLE shop_items ADD COLUMN oncePerUser TINYINT(1) DEFAULT 0;').catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
}

module.exports = { name: '0016_shop_once', up };
