const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Warning extends Model {}

  Warning.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      moderatorId: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.STRING, defaultValue: 'Без причины' },
      // JSON { action, ms, status: applied | failed | already | skipped, error } of the automatic punishment this warning triggered
      autoAction: { type: DataTypes.TEXT, allowNull: true },
      // a removed warning stays in the history
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      revokedBy: { type: DataTypes.STRING, allowNull: true },
      revokeReason: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'Warning', tableName: 'warnings' }
  );

  return Warning;
};
