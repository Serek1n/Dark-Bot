const { DataTypes, Model } = require('sequelize');

// Access to the panel without the right to manage the server (web/utils/access.js): a role or a member of one server and
// the scopes it gives. A member's rights are the union of his own entry and the entries of his current roles.
module.exports = (sequelize) => {
  class PanelRoleAccess extends Model {}
  PanelRoleAccess.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      targetType: { type: DataTypes.STRING(8), allowNull: false }, // role | user
      targetId: { type: DataTypes.STRING, allowNull: false },
      scopes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' }, // JSON: ['overview.view', …]
      presetId: { type: DataTypes.STRING(32), allowNull: true },
      updatedBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'PanelRoleAccess', tableName: 'panel_role_access', indexes: [{ unique: true, fields: ['guildId', 'targetType', 'targetId'] }, { fields: ['guildId'] }] }
  );
  return PanelRoleAccess;
};
