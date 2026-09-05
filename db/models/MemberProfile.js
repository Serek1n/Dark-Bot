const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class MemberProfile extends Model {}

  MemberProfile.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      xp: { type: DataTypes.BIGINT, defaultValue: 0 },
      level: { type: DataTypes.INTEGER, defaultValue: 0 },
      balance: { type: DataTypes.BIGINT, defaultValue: 0 },
      lastXpAt: { type: DataTypes.DATE, allowNull: true },
      lastDailyAt: { type: DataTypes.DATE, allowNull: true },
      messageCount: { type: DataTypes.BIGINT, defaultValue: 0 }
    },
    {
      sequelize,
      modelName: 'MemberProfile',
      tableName: 'member_profiles',
      indexes: [{ unique: true, fields: ['guildId', 'userId'] }]
    }
  );

  return MemberProfile;
};
