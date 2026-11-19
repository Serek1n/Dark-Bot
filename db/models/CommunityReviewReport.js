const { DataTypes, Model } = require('sequelize');

// A complaint about one review (one per person per review); the platform's moderation sees reviews with complaints.
module.exports = (sequelize) => {
  class CommunityReviewReport extends Model {}
  CommunityReviewReport.init(
    {
      reviewId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.STRING(300), allowNull: false }
    },
    { sequelize, modelName: 'CommunityReviewReport', tableName: 'community_review_reports', updatedAt: false, indexes: [{ unique: true, fields: ['reviewId', 'userId'] }] }
  );
  return CommunityReviewReport;
};
