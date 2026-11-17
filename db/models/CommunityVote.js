const { DataTypes, Model } = require('sequelize');

// One vote: who, for what, from which network (a hash, never the address itself).
module.exports = (sequelize) => {
  class CommunityVote extends Model {}
  CommunityVote.init(
    {
      communityId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      ipHash: { type: DataTypes.STRING(64), allowNull: true }
    },
    { sequelize, modelName: 'CommunityVote', tableName: 'community_votes', updatedAt: false, indexes: [{ fields: ['communityId', 'createdAt'] }, { fields: ['userId', 'communityId'] }, { fields: ['ipHash', 'createdAt'] }] }
  );
  return CommunityVote;
};
