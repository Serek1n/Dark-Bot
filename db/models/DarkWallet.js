const { DataTypes, Model } = require('sequelize');

// DARK Coins: the platform's own currency (promotion of communities). Not a server's money: no economy command, no panel
// setting and no server admin can change it. The balance changes only inside bot/modules/darkCoins.js, together with a line
// in dark_coin_tx, in one transaction.
module.exports = (sequelize) => {
  class DarkWallet extends Model {}
  DarkWallet.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false, unique: true }, // a Discord user id, or g<guildId> — a server's wallet
      balance: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      frozen: { type: DataTypes.BOOLEAN, defaultValue: false } // by the platform owner: no rewards, no spending
    },
    { sequelize, modelName: 'DarkWallet', tableName: 'dark_wallets' }
  );
  return DarkWallet;
};
