const { DataTypes, Model } = require('sequelize');

// A role given for a while (/temprole): taken away by the scheduler at expiresAt.
module.exports = (sequelize) => {
  class TempRole extends Model {}
  TempRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      roleId: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      givenBy: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.STRING, allowNull: true },
      caseNumber: { type: DataTypes.INTEGER, allowNull: true } // the case of /temprole give (ModLog)
    },
    { sequelize, modelName: 'TempRole', tableName: 'temp_roles', indexes: [{ fields: ['expiresAt'] }, { unique: true, fields: ['guildId', 'userId', 'roleId'] }] }
  );
  return TempRole;
};
