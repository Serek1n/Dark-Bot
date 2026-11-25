const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Ticket extends Model {}
  Ticket.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      number: { type: DataTypes.INTEGER, allowNull: false }, // per-server number: ticket-0001
      status: { type: DataTypes.STRING, defaultValue: 'open' }, // open | closed
      closedBy: { type: DataTypes.STRING, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
      category: { type: DataTypes.STRING, allowNull: true }, // the topic the member chose (its label)
      answers: { type: DataTypes.TEXT, allowNull: true }, // JSON: [{ q, a }] from the form of the topic
      lastActivityAt: { type: DataTypes.DATE, allowNull: true }, // the last message in the channel (auto-close)
      warnedAt: { type: DataTypes.DATE, allowNull: true }, // the «closes soon» warning was sent
      rating: { type: DataTypes.INTEGER, allowNull: true }, // 1–5 from the author after closing
      transcript: { type: DataTypes.TEXT, allowNull: true }, // the conversation, kept for the panel
      closeReason: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'Ticket', tableName: 'tickets', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['channelId'] }] }
  );
  return Ticket;
};
