const { DataTypes, Model } = require('sequelize');

// One unlocked achievement of one member on one server. key: a built-in key ('msg_100') or 'c<id>' for a server's own.
// The unique index is what makes a second grant impossible, even when two checks run at the same moment.
module.exports = (sequelize) => {
  class MemberAchievement extends Model {}
  MemberAchievement.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      key: { type: DataTypes.STRING(40), allowNull: false },
      grantedBy: { type: DataTypes.STRING, allowNull: true } // null: unlocked by itself
    },
    {
      sequelize,
      modelName: 'MemberAchievement',
      tableName: 'member_achievements',
      updatedAt: false,
      indexes: [{ unique: true, fields: ['guildId', 'userId', 'key'] }, { fields: ['guildId', 'key'] }]
    }
  );
  return MemberAchievement;
};
