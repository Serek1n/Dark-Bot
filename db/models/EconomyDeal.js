const { DataTypes, Model } = require('sequelize');

// A deal with the bot as the guarantor: the buyer's money is frozen and goes to the seller only when both say it is done
// (or a moderator decides a dispute).
module.exports = (sequelize) => {
  class EconomyDeal extends Model {}
  EconomyDeal.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      buyerId: { type: DataTypes.STRING, allowNull: false },
      sellerId: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      // pending (waits for the seller) | active | disputed | done | refunded (declined, cancelled, expired, or a moderator)
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      buyerDone: { type: DataTypes.BOOLEAN, defaultValue: false },
      sellerDone: { type: DataTypes.BOOLEAN, defaultValue: false },
      outcome: { type: DataTypes.STRING, allowNull: true }, // why it ended, in words
      channelId: { type: DataTypes.STRING, allowNull: true },
      messageId: { type: DataTypes.STRING, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true } // a pending deal nobody accepted is returned then
    },
    { sequelize, modelName: 'EconomyDeal', tableName: 'economy_deals', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['status', 'expiresAt'] }] }
  );
  return EconomyDeal;
};
