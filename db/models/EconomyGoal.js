const { DataTypes, Model } = require('sequelize');

// A goal the whole server saves up for. When it is reached the bot does the action; when time runs out first, everyone gets back
// what they put in.
module.exports = (sequelize) => {
  class EconomyGoal extends Model {}
  EconomyGoal.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      target: { type: DataTypes.INTEGER, allowNull: false },
      raised: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      action: { type: DataTypes.STRING, allowNull: false, defaultValue: 'announce' }, // boost | role | announce
      boostMult: { type: DataTypes.FLOAT, allowNull: true },
      boostHours: { type: DataTypes.INTEGER, allowNull: true },
      roleId: { type: DataTypes.STRING, allowNull: true },
      reward: { type: DataTypes.STRING, allowNull: true }, // what the announcement promises, in the admin's words
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' }, // open | done | failed | cancelled
      channelId: { type: DataTypes.STRING, allowNull: true },
      messageId: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'EconomyGoal', tableName: 'economy_goals', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['status', 'endsAt'] }] }
  );
  return EconomyGoal;
};
