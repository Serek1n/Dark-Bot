const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Warning extends Model {}

  Warning.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      moderatorId: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.STRING, defaultValue: 'Без причины' }
    },
    { sequelize, modelName: 'Warning', tableName: 'warnings' }
  );

  return Warning;
};
