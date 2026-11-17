const { DataTypes, Model } = require('sequelize');

// The journal of DARK Coins: every change of a wallet, with who did it and the operation key. The key is unique: the same
// operation sent twice (a double click, a repeated form) is written once.
module.exports = (sequelize) => {
  class DarkCoinTx extends Model {}
  DarkCoinTx.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.BIGINT, allowNull: false }, // + in, − out
      balanceAfter: { type: DataTypes.BIGINT, allowNull: false },
      kind: { type: DataTypes.STRING(20), allowNull: false }, // grant | revoke | promo
      opKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      actorId: { type: DataTypes.STRING, allowNull: true }, // the platform owner for grant / revoke; the buyer for promo
      note: { type: DataTypes.STRING(200), allowNull: true }
    },
    { sequelize, modelName: 'DarkCoinTx', tableName: 'dark_coin_tx', updatedAt: false, indexes: [{ fields: ['userId', 'id'] }] }
  );
  return DarkCoinTx;
};
