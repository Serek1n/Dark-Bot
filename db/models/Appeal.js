const { DataTypes, Model } = require('sequelize');

// An appeal against a punishment. The punishment is pointed to by its own record (a ModLog case for a ban or a mute, a
// Warning for a warning); what it was is copied at the moment of filing, so the appeal stays readable whatever happens later.
// status: new → review (⇄ info: more is asked of the author) → approved | rejected. A decision is written only by a conditional update (status still open), so the
// same appeal can never be decided twice.
module.exports = (sequelize) => {
  class Appeal extends Model {}
  Appeal.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      kind: { type: DataTypes.STRING(10), allowNull: false }, // ban | mute | warn | role_mute | quarantine
      source: { type: DataTypes.STRING(8), defaultValue: 'web' }, // web | dm
      modLogId: { type: DataTypes.INTEGER, allowNull: true },
      warningId: { type: DataTypes.INTEGER, allowNull: true },
      caseNumber: { type: DataTypes.INTEGER, allowNull: true },
      punishReason: { type: DataTypes.STRING(300), allowNull: true },
      punishedAt: { type: DataTypes.DATE, allowNull: true },
      punishUntil: { type: DataTypes.DATE, allowNull: true },
      text: { type: DataTypes.TEXT, allowNull: false },
      links: { type: DataTypes.STRING(600), allowNull: true },
      status: { type: DataTypes.STRING(10), defaultValue: 'new' },
      moderatorId: { type: DataTypes.STRING, allowNull: true },
      decisionReason: { type: DataTypes.STRING(500), allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      actionResult: { type: DataTypes.STRING(300), allowNull: true }
    },
    { sequelize, modelName: 'Appeal', tableName: 'appeals', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['userId'] }] }
  );
  return Appeal;
};
