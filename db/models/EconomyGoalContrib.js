const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class EconomyGoalContrib extends Model {}
  EconomyGoalContrib.init(
    {
      goalId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false }, // '' = the server's treasury
      amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    },
    { sequelize, modelName: 'EconomyGoalContrib', tableName: 'economy_goal_contribs', timestamps: false, indexes: [{ unique: true, fields: ['goalId', 'userId'] }] }
  );
  return EconomyGoalContrib;
};
