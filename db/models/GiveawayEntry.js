const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class GiveawayEntry extends Model {}
  GiveawayEntry.init(
    {
      giveawayId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false }
    },
    { sequelize, modelName: 'GiveawayEntry', tableName: 'giveaway_entries', indexes: [{ unique: true, fields: ['giveawayId', 'userId'] }] }
  );
  return GiveawayEntry;
};
