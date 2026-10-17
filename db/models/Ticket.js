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
      closedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'Ticket', tableName: 'tickets', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['channelId'] }] }
  );
  return Ticket;
};
