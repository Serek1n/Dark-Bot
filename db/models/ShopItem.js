const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ShopItem extends Model {}

  ShopItem.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, defaultValue: '' },
      price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'coins' }, // coins | crystals
      type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'role' }, // role | item
      roleId: { type: DataTypes.STRING, allowNull: true }, // for type "role": given on purchase
      stock: { type: DataTypes.INTEGER, allowNull: true }, // null = unlimited
      minLevel: { type: DataTypes.INTEGER, defaultValue: 0 },
      deliveryMessage: { type: DataTypes.TEXT, defaultValue: '' }, // shown to the buyer (e.g. a code or instructions)
      enabled: { type: DataTypes.BOOLEAN, defaultValue: true }
    },
    { sequelize, modelName: 'ShopItem', tableName: 'shop_items', indexes: [{ fields: ['guildId'] }] }
  );

  return ShopItem;
};
