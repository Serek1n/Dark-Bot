const { DataTypes, Model } = require('sequelize');

// An achievement a server made itself (the built-in ones live in bot/modules/achievements.js). condType says what is
// counted and condValue how much is needed; 'manual' ones are only given by hand (the panel or /achievements grant).
module.exports = (sequelize) => {
  class Achievement extends Model {}
  Achievement.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: false },
      description: { type: DataTypes.STRING(200), defaultValue: '' },
      emoji: { type: DataTypes.STRING(64), defaultValue: '🏆' },
      imageUrl: { type: DataTypes.STRING(400), allowNull: true },
      category: { type: DataTypes.STRING(20), defaultValue: 'special' },
      rarity: { type: DataTypes.STRING(20), defaultValue: 'common' },
      condType: { type: DataTypes.STRING(20), defaultValue: 'manual' },
      condValue: { type: DataTypes.INTEGER, defaultValue: 0 },
      condRoleId: { type: DataTypes.STRING, allowNull: true },
      rewardCoins: { type: DataTypes.INTEGER, defaultValue: 0 },
      rewardCrystals: { type: DataTypes.INTEGER, defaultValue: 0 },
      rewardRoleId: { type: DataTypes.STRING, allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      hidden: { type: DataTypes.BOOLEAN, defaultValue: false },
      createdBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'Achievement', tableName: 'achievements', indexes: [{ fields: ['guildId'] }] }
  );
  return Achievement;
};
