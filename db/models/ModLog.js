const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ModLog extends Model {}

  ModLog.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      moderatorId: { type: DataTypes.STRING, allowNull: false },
      action: { type: DataTypes.ENUM('warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'automod'), allowNull: false },
      reason: { type: DataTypes.STRING, defaultValue: 'Без причины' }
    },
    { sequelize, modelName: 'ModLog', tableName: 'mod_logs' }
  );

  return ModLog;
};
