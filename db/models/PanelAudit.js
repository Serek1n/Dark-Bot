const { DataTypes, Model } = require('sequelize');

// What was changed through the panel by whom: the access matrix and every change made by a member with delegated
// rights (web/middleware/panelAudit.js). Never the contents of forms.
module.exports = (sequelize) => {
  class PanelAudit extends Model {}
  PanelAudit.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: true },
      action: { type: DataTypes.STRING(40), allowNull: false }, // access.grant | access.revoke | access.strict | change
      detail: { type: DataTypes.STRING(500), allowNull: true }
    },
    { sequelize, modelName: 'PanelAudit', tableName: 'panel_audit', updatedAt: false, indexes: [{ fields: ['guildId', 'createdAt'] }] }
  );
  return PanelAudit;
};
