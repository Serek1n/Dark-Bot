const { DataTypes, Model } = require('sequelize');

// "Сезон 3 · #1": the place a member took in the wealth top when a season ended. Kept for good.
module.exports = (sequelize) => {
  class EconomyBadge extends Model {}
  EconomyBadge.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      season: { type: DataTypes.INTEGER, allowNull: false },
      place: { type: DataTypes.INTEGER, allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    },
    { sequelize, modelName: 'EconomyBadge', tableName: 'economy_badges', updatedAt: false, indexes: [{ fields: ['guildId', 'userId'] }, { fields: ['guildId', 'season'] }] }
  );
  return EconomyBadge;
};
