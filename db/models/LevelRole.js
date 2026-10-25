const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LevelRole extends Model {}

  LevelRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      roleId: { type: DataTypes.STRING, allowNull: false },
      track: { type: DataTypes.STRING, allowNull: false, defaultValue: 'total' }, // total | chat | voice
      keep: { type: DataTypes.BOOLEAN, defaultValue: false } // stays with the member even in "replace" mode
    },
    // The unique index (guildId, track, level) is created in db/index.js: older databases
    // have an index without `track` that has to be replaced first.
    { sequelize, modelName: 'LevelRole', tableName: 'level_roles' }
  );

  return LevelRole;
};
