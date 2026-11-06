const { DataTypes, Model } = require('sequelize');

// Messages the bot posts by itself on a schedule (bot/modules/scheduledMessages.js). A pasted webhook link is kept encrypted.
module.exports = (sequelize) => {
  class ScheduledMessage extends Model {}
  ScheduledMessage.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      data: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' }, // the message, as the editor sends it
      target: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' }, // { mode, webhookId | channelId, threadId, threadName }
      webhookUrl: { type: DataTypes.TEXT, allowNull: true }, // encrypted (db/crypto)
      rule: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' },
      timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Europe/Moscow' },
      nextRunAt: { type: DataTypes.DATE, allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      canEveryone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // the author could ping @everyone when saving
      lastRunAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.STRING(255), allowNull: true },
      runs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'ScheduledMessage', tableName: 'scheduled_messages', indexes: [{ fields: ['guildId'] }, { fields: ['enabled', 'nextRunAt'] }] }
  );
  return ScheduledMessage;
};
