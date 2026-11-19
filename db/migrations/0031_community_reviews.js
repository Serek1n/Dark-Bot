// «Сообщества»: reviews with a rating, the server's rules, links and screenshots, a channel for news about reviews.
// The tables of reviews, complaints about them and favourites are new, so sequelize.sync() creates them.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(communities);');
  if (!cols.length) return;
  const add = [['ratingSum', 'INTEGER DEFAULT 0'], ['ratingCount', 'INTEGER DEFAULT 0'], ['rules', 'TEXT'], ['links', 'TEXT'], ['gallery', 'TEXT'], ['notifyChannelId', 'VARCHAR(255)']];
  for (const [name, type] of add) {
    if (cols.some((c) => c.name === name)) continue;
    await sequelize.query(`ALTER TABLE communities ADD COLUMN ${name} ${type};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  }
}

module.exports = { name: '0031_community_reviews', up };
