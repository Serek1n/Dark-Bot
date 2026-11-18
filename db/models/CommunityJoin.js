const { DataTypes, Model } = require('sequelize');

// «Присоединиться» pressed by a signed-in person (clickedAt), and then the bot saw him really join (joinedAt). One row per
// person and server: a server is rewarded only once for the same person.
module.exports = (sequelize) => {
  class CommunityJoin extends Model {}
  CommunityJoin.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      ipHash: { type: DataTypes.STRING(64), allowNull: true },
      clickedAt: { type: DataTypes.DATE, allowNull: false },
      joinedAt: { type: DataTypes.DATE, allowNull: true },
      rewarded: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    { sequelize, modelName: 'CommunityJoin', tableName: 'community_joins', timestamps: false, indexes: [{ unique: true, fields: ['guildId', 'userId'] }, { fields: ['ipHash', 'joinedAt'] }] }
  );
  return CommunityJoin;
};
