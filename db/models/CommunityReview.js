const { DataTypes, Model } = require('sequelize');

// A review of a community: one per person (it can be changed), a mark from 1 to 5 and a few words; the server's admins may
// answer it once (the answer can be changed). status: published | hidden (by the platform's moderation, after complaints).
module.exports = (sequelize) => {
  class CommunityReview extends Model {}
  CommunityReview.init(
    {
      communityId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      rating: { type: DataTypes.INTEGER, allowNull: false },
      text: { type: DataTypes.STRING(600), allowNull: false, defaultValue: '' },
      reply: { type: DataTypes.STRING(600), allowNull: true },
      replyBy: { type: DataTypes.STRING, allowNull: true },
      replyAt: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING(12), defaultValue: 'published' },
      reports: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { sequelize, modelName: 'CommunityReview', tableName: 'community_reviews', indexes: [{ unique: true, fields: ['communityId', 'userId'] }, { fields: ['communityId', 'status', 'createdAt'] }, { fields: ['reports'] }] }
  );
  return CommunityReview;
};
