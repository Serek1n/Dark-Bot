const { DataTypes, Model } = require('sequelize');

// A bought promotion. kind: bump (raised for a day), pin (on top), highlight (a marked card), featured (in «Рекомендуем»).
// Active while endsAt is ahead; txId is the payment in dark_coin_tx (unique: one payment — one promotion).
module.exports = (sequelize) => {
  class CommunityPromotion extends Model {}
  CommunityPromotion.init(
    {
      communityId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.STRING(12), allowNull: false },
      days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      price: { type: DataTypes.INTEGER, allowNull: false },
      buyerId: { type: DataTypes.STRING, allowNull: false },
      txId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false }
    },
    { sequelize, modelName: 'CommunityPromotion', tableName: 'community_promotions', updatedAt: false, indexes: [{ fields: ['communityId', 'endsAt'] }, { fields: ['kind', 'endsAt'] }] }
  );
  return CommunityPromotion;
};
