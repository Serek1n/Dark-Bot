const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Purchase extends Model {}

  Purchase.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      itemId: { type: DataTypes.INTEGER, allowNull: true },
      itemName: { type: DataTypes.STRING, allowNull: false }, // kept even if the item is deleted later
      itemType: { type: DataTypes.STRING, defaultValue: 'item' },
      roleId: { type: DataTypes.STRING, allowNull: true },
      price: { type: DataTypes.INTEGER, allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false },
      // pending = the owner still has to hand it over, done = delivered, refunded = money returned
      status: { type: DataTypes.STRING, defaultValue: 'done' }
    },
    { sequelize, modelName: 'Purchase', tableName: 'purchases', indexes: [{ fields: ['guildId', 'userId'] }, { fields: ['guildId', 'createdAt'] }] }
  );

  return Purchase;
};
