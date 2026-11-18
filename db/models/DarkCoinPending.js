const { DataTypes, Model } = require('sequelize');

// A DARK Coins reward that is not paid yet: it waits (payAt) so that it can be cancelled if it turns out to be a cheat —
// the member left the server, the voter's wallet got frozen. status: pending → paid | cancelled; held — the platform's daily
// limit was reached, waits for the owner's decision. opKey is unique: the same reward is never queued twice.
module.exports = (sequelize) => {
  class DarkCoinPending extends Model {}
  DarkCoinPending.init(
    {
      wallet: { type: DataTypes.STRING(30), allowNull: false }, // a user id, or g<guildId> for a server's wallet
      amount: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.STRING(20), allowNull: false }, // join | vote
      opKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      note: { type: DataTypes.STRING(200), allowNull: true },
      guildId: { type: DataTypes.STRING, allowNull: true }, // the server the condition is checked on
      userId: { type: DataTypes.STRING, allowNull: true }, // the member the condition is about
      status: { type: DataTypes.STRING(10), defaultValue: 'pending' },
      reason: { type: DataTypes.STRING(200), allowNull: true }, // why cancelled / held
      payAt: { type: DataTypes.DATE, allowNull: false }
    },
    { sequelize, modelName: 'DarkCoinPending', tableName: 'dark_coin_pending', indexes: [{ fields: ['status', 'payAt'] }, { fields: ['wallet'] }] }
  );
  return DarkCoinPending;
};
