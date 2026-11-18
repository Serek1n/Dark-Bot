// DARK Coins: a wallet can be frozen by the platform owner (no automatic rewards, no spending). New tables (pending
// rewards, Telegram orders, verified joins, daily bonus) are created by sequelize.sync.
async function up({ sequelize }) {
  const [cols] = await sequelize.query('PRAGMA table_info(dark_wallets);');
  if (!cols.length || cols.some((c) => c.name === 'frozen')) return;
  await sequelize.query('ALTER TABLE dark_wallets ADD COLUMN frozen TINYINT(1) DEFAULT 0;').catch((err) => {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  });
}

module.exports = { name: '0027_dark_wallet_frozen', up };
