const { DataTypes, Model } = require('sequelize');

// Steady income summed per member, per day and per source (chat, voice, level), so a message costs one small additive statement
// instead of a journal row of its own.
module.exports = (sequelize) => {
  class EconomyEarn extends Model {}
  EconomyEarn.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      day: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD (UTC)
      kind: { type: DataTypes.STRING, allowNull: false }, // chat | voice | level
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'coins' },
      amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    },
    {
      sequelize, modelName: 'EconomyEarn', tableName: 'economy_earn', timestamps: false,
      indexes: [{ unique: true, fields: ['guildId', 'userId', 'day', 'kind', 'currency'] }, { fields: ['guildId', 'day'] }]
    }
  );
  return EconomyEarn;
};
