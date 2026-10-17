const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Reminder extends Model {}
  Reminder.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: true },
      channelId: { type: DataTypes.STRING, allowNull: true }, // where to remind; DM when missing or unreachable
      text: { type: DataTypes.STRING, allowNull: false },
      remindAt: { type: DataTypes.DATE, allowNull: false }
    },
    { sequelize, modelName: 'Reminder', tableName: 'reminders', indexes: [{ fields: ['remindAt'] }, { fields: ['userId'] }] }
  );
  return Reminder;
};
