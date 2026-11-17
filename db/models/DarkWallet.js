const { DataTypes, Model } = require('sequelize');

// DARK Coins: the platform's own currency (promotion of communities). Not a server's money: no economy command, no panel
// setting and no server admin can change it. The balance changes only inside bot/modules/darkCoins.js, together with a line
// in dark_coin_tx, in one transaction.
module.exports = (sequelize) => {
  class DarkWallet extends Model {}
  DarkWallet.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false, unique: true },
      balance: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 }
    },
    { sequelize, modelName: 'DarkWallet', tableName: 'dark_wallets' }
  );
  return DarkWallet;
};
