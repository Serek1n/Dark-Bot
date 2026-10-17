const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Poll extends Model {}
  Poll.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false },
      question: { type: DataTypes.STRING, allowNull: false },
      options: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' }, // JSON: [{ emoji, label }]
      endsAt: { type: DataTypes.DATE, allowNull: false },
      ended: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    { sequelize, modelName: 'Poll', tableName: 'polls', indexes: [{ fields: ['ended', 'endsAt'] }] }
  );
  return Poll;
};
