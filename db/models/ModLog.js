const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ModLog extends Model {}

  ModLog.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      moderatorId: { type: DataTypes.STRING, allowNull: false },
      action: { type: DataTypes.ENUM('warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'automod', 'note'), allowNull: false },
      reason: { type: DataTypes.STRING, defaultValue: 'Без причины' },
      caseNumber: { type: DataTypes.INTEGER, allowNull: true }, // per server: "дело #12"
      duration: { type: DataTypes.BIGINT, allowNull: true }, // ms, for temporary mutes and bans
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      active: { type: DataTypes.BOOLEAN, defaultValue: false } // a temporary ban that still has to be lifted
    },
    { sequelize, modelName: 'ModLog', tableName: 'mod_logs' }
  );

  return ModLog;
};
