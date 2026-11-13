const { DataTypes, Model } = require('sequelize');

// A transfer to a newcomer, held for a while: the sender has already paid, the newcomer gets it at releaseAt (an admin can send it
// back to the sender before that).
module.exports = (sequelize) => {
  class EconomyHold extends Model {}
  EconomyHold.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      fromId: { type: DataTypes.STRING, allowNull: false },
      toId: { type: DataTypes.STRING, allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'coins' },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      releaseAt: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'held' } // held | released | returned
    },
    { sequelize, modelName: 'EconomyHold', tableName: 'economy_holds', indexes: [{ fields: ['status', 'releaseAt'] }, { fields: ['guildId', 'status'] }] }
  );
  return EconomyHold;
};
