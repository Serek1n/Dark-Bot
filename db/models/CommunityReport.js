const { DataTypes, Model } = require('sequelize');

// A complaint about a community's card, read by the platform's moderators on /platform.
module.exports = (sequelize) => {
  class CommunityReport extends Model {}
  CommunityReport.init(
    {
      communityId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: false },
      status: { type: DataTypes.STRING(10), defaultValue: 'open' } // open | closed
    },
    { sequelize, modelName: 'CommunityReport', tableName: 'community_reports', indexes: [{ fields: ['status'] }, { unique: true, fields: ['communityId', 'userId'] }] }
  );
  return CommunityReport;
};
