const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Giveaway extends Model {}
  Giveaway.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: true },
      hostId: { type: DataTypes.STRING, allowNull: false },
      prize: { type: DataTypes.STRING, allowNull: false },
      winnersCount: { type: DataTypes.INTEGER, defaultValue: 1 },
      requiredRoleId: { type: DataTypes.STRING, allowNull: true }, // only members with this role may enter
      endsAt: { type: DataTypes.DATE, allowNull: false },
      ended: { type: DataTypes.BOOLEAN, defaultValue: false },
      winners: { type: DataTypes.TEXT, defaultValue: '[]' } // JSON [userId]
    },
    { sequelize, modelName: 'Giveaway', tableName: 'giveaways', indexes: [{ fields: ['ended', 'endsAt'] }, { fields: ['guildId'] }] }
  );
  return Giveaway;
};
