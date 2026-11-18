const { DataTypes, Model } = require('sequelize');

// The platform's daily bonus of one person: the last day it was taken (UTC) and the current streak.
module.exports = (sequelize) => {
  class DarkDaily extends Model {}
  DarkDaily.init(
    {
      userId: { type: DataTypes.STRING, allowNull: false, unique: true },
      lastDay: { type: DataTypes.STRING(10), allowNull: true },
      streak: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { sequelize, modelName: 'DarkDaily', tableName: 'dark_daily', timestamps: false }
  );
  return DarkDaily;
};
