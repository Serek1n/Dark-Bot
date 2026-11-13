const { DataTypes, Model } = require('sequelize');

// One row per server per day: how much money there is. The central bank's chart and its inflation figure come from these.
module.exports = (sequelize) => {
  class EconomySupply extends Model {}
  EconomySupply.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      day: { type: DataTypes.STRING, allowNull: false },
      coins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      crystals: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      holders: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1 } // the reward rate the bank set that day
    },
    { sequelize, modelName: 'EconomySupply', tableName: 'economy_supply', timestamps: false, indexes: [{ unique: true, fields: ['guildId', 'day'] }] }
  );
  return EconomySupply;
};
