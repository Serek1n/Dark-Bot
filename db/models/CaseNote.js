const { DataTypes, Model } = require('sequelize');

// The inside of a moderation case: moderators' notes and every change of its reason or length (who, when, from what).
module.exports = (sequelize) => {
  class CaseNote extends Model {}
  CaseNote.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      caseNumber: { type: DataTypes.INTEGER, allowNull: false },
      authorId: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING(10), defaultValue: 'note' }, // note | reason | duration | lifted
      text: { type: DataTypes.STRING(1000), allowNull: false }
    },
    { sequelize, modelName: 'CaseNote', tableName: 'case_notes', updatedAt: false, indexes: [{ fields: ['guildId', 'caseNumber'] }] }
  );
  return CaseNote;
};
