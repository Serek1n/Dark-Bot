const { DataTypes, Model } = require('sequelize');

// A punishment by a role (bot/modules/punishments.js): a mute role (longer than Discord's 28-day timeout, or until
// lifted), quarantine (all roles taken and kept here, one quarantine role given) or a restriction role (no media, no
// voice…). Lifted by the scheduler at expiresAt (null: until a moderator lifts it); given again when the member rejoins.
module.exports = (sequelize) => {
  class RolePunishment extends Model {}
  RolePunishment.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      kind: { type: DataTypes.STRING(12), allowNull: false }, // role_mute | quarantine | restrict
      roleId: { type: DataTypes.STRING, allowNull: false },
      savedRoles: { type: DataTypes.TEXT, allowNull: true }, // quarantine: JSON of the roles taken, given back when lifted
      caseNumber: { type: DataTypes.INTEGER, allowNull: true },
      reason: { type: DataTypes.STRING, allowNull: true },
      givenBy: { type: DataTypes.STRING, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      active: { type: DataTypes.BOOLEAN, defaultValue: true },
      liftedAt: { type: DataTypes.DATE, allowNull: true },
      liftedBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'RolePunishment', tableName: 'role_punishments', indexes: [{ fields: ['guildId', 'userId', 'active'] }, { fields: ['active', 'expiresAt'] }] }
  );
  return RolePunishment;
};
