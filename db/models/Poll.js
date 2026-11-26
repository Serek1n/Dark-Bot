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
      ended: { type: DataTypes.BOOLEAN, defaultValue: false },
      action: { type: DataTypes.TEXT, allowNull: true },
      anonymous: { type: DataTypes.BOOLEAN, defaultValue: false }, // votes by buttons, who voted is not shown
      multi: { type: DataTypes.BOOLEAN, defaultValue: true }, // several options per member
      votes: { type: DataTypes.TEXT, allowNull: true }, // JSON { userId: [option index] } of a button poll
      authorId: { type: DataTypes.STRING, allowNull: true } // JSON: what the winning option does (a treasury vote), null = just a poll
    },
    { sequelize, modelName: 'Poll', tableName: 'polls', indexes: [{ fields: ['ended', 'endsAt'] }, { name: 'polls_message_id', fields: ['messageId'] }] }
  );
  return Poll;
};
