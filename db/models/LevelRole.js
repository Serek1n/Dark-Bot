const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LevelRole extends Model {}

  LevelRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      roleId: { type: DataTypes.STRING, allowNull: false }
    },
    {
      sequelize,
      modelName: 'LevelRole',
      tableName: 'level_roles',
      indexes: [{ unique: true, fields: ['guildId', 'level'] }]
    }
  );

  return LevelRole;
};
