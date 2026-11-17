const { DataTypes, Model } = require('sequelize');

// Views, clicks on «Присоединиться» and votes of a community per day (UTC), for its statistics.
module.exports = (sequelize) => {
  class CommunityStat extends Model {}
  CommunityStat.init(
    {
      communityId: { type: DataTypes.INTEGER, allowNull: false },
      day: { type: DataTypes.STRING(10), allowNull: false },
      views: { type: DataTypes.INTEGER, defaultValue: 0 },
      clicks: { type: DataTypes.INTEGER, defaultValue: 0 },
      votes: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { sequelize, modelName: 'CommunityStat', tableName: 'community_stats', timestamps: false, indexes: [{ unique: true, fields: ['communityId', 'day'] }] }
  );
  return CommunityStat;
};
