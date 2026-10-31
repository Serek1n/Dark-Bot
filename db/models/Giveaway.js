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
      winners: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON [userId]
      // The prize the bot hands out by itself: coins | crystals (rewardAmount) or role (rewardRoleId, rewardSeconds — 0/null = forever)
      rewardType: { type: DataTypes.STRING, allowNull: true },
      rewardAmount: { type: DataTypes.INTEGER, allowNull: true },
      rewardRoleId: { type: DataTypes.STRING, allowNull: true },
      rewardSeconds: { type: DataTypes.INTEGER, allowNull: true },
      rewarded: { type: DataTypes.TEXT, defaultValue: '[]' } // JSON [userId] who already got the prize (a reroll never pays twice)
    },
    { sequelize, modelName: 'Giveaway', tableName: 'giveaways', indexes: [{ fields: ['ended', 'endsAt'] }, { fields: ['guildId'] }] }
  );
  return Giveaway;
};
