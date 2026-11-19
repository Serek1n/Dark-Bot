const { DataTypes, Model } = require('sequelize');

// A community a person saved in «Избранное» of the catalog.
module.exports = (sequelize) => {
  class CommunityFavorite extends Model {}
  CommunityFavorite.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false },
      communityId: { type: DataTypes.INTEGER, allowNull: false }
    },
    { sequelize, modelName: 'CommunityFavorite', tableName: 'community_favorites', updatedAt: false, indexes: [{ unique: true, fields: ['userId', 'communityId'] }, { fields: ['communityId'] }] }
  );
  return CommunityFavorite;
};
