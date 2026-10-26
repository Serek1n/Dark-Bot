const { DataTypes, Model } = require('sequelize');

// A message that made it to the starboard ("Доска почёта"): where the copy is, and how many reactions it has.
module.exports = (sequelize) => {
  class StarboardEntry extends Model {}
  StarboardEntry.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false, unique: true },
      channelId: { type: DataTypes.STRING, allowNull: false },
      authorId: { type: DataTypes.STRING, allowNull: true },
      starMessageId: { type: DataTypes.STRING, allowNull: true },
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    },
    { sequelize, modelName: 'StarboardEntry', tableName: 'starboard_entries', indexes: [{ fields: ['guildId', 'count'] }] }
  );
  return StarboardEntry;
};
