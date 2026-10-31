const { DataTypes, Model } = require('sequelize');

// A report about a member (/report, or "Пожаловаться" on a message or a member), and what the moderators decided.
module.exports = (sequelize) => {
  class Report extends Model {}
  Report.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      reporterId: { type: DataTypes.STRING, allowNull: false },
      targetId: { type: DataTypes.STRING, allowNull: false },
      category: { type: DataTypes.STRING, allowNull: false, defaultValue: 'other' },
      reason: { type: DataTypes.TEXT, allowNull: true },
      messageUrl: { type: DataTypes.STRING, allowNull: true },
      messageText: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' }, // open | done | ignored
      decision: { type: DataTypes.STRING, allowNull: true },
      handledBy: { type: DataTypes.STRING, allowNull: true },
      logChannelId: { type: DataTypes.STRING, allowNull: true },
      logMessageId: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'Report', tableName: 'reports', indexes: [{ fields: ['guildId', 'targetId', 'createdAt'] }, { fields: ['guildId', 'reporterId', 'createdAt'] }] }
  );
  return Report;
};
