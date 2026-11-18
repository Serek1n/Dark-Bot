const { DataTypes, Model } = require('sequelize');

// A purchase of DARK Coins for Telegram Stars. Made on the site by a signed-in Discord user (so the coins always go to HIS
// wallet), paid in the Telegram bot. token: the secret part of the t.me link; chargeId: Telegram's id of the payment,
// unique — one payment credits once. status: created → paid → refunded.
module.exports = (sequelize) => {
  class DarkCoinOrder extends Model {}
  DarkCoinOrder.init(
    {
      token: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      packageKey: { type: DataTypes.STRING(20), allowNull: false },
      coins: { type: DataTypes.INTEGER, allowNull: false },
      stars: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.STRING(10), defaultValue: 'created' },
      tgUserId: { type: DataTypes.STRING, allowNull: true },
      chargeId: { type: DataTypes.STRING(120), allowNull: true, unique: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      refundedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DarkCoinOrder', tableName: 'dark_coin_orders', indexes: [{ fields: ['userId'] }, { fields: ['status'] }] }
  );
  return DarkCoinOrder;
};
