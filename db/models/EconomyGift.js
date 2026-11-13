const { DataTypes, Model } = require('sequelize');

// A one-time gift code: whoever enters it first gets the amount.
module.exports = (sequelize) => {
  class EconomyGift extends Model {}
  EconomyGift.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      creatorId: { type: DataTypes.STRING, allowNull: true }, // null = made by an admin in the panel
      batch: { type: DataTypes.STRING, allowNull: true },
      redeemedBy: { type: DataTypes.STRING, allowNull: true },
      redeemedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'EconomyGift', tableName: 'economy_gifts', indexes: [{ unique: true, fields: ['guildId', 'code'] }, { fields: ['guildId', 'creatorId', 'createdAt'] }] }
  );
  return EconomyGift;
};
