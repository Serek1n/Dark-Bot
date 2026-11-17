const { DataTypes, Model } = require('sequelize');

// The history of an appeal: moderators' comments (visible to the author or only to the team) and every change of status.
module.exports = (sequelize) => {
  class AppealNote extends Model {}
  AppealNote.init(
    {
      appealId: { type: DataTypes.INTEGER, allowNull: false },
      authorId: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING(10), defaultValue: 'comment' }, // comment | status
      text: { type: DataTypes.STRING(1000), allowNull: false },
      visible: { type: DataTypes.BOOLEAN, defaultValue: false } // shown to the author
    },
    { sequelize, modelName: 'AppealNote', tableName: 'appeal_notes', updatedAt: false, indexes: [{ fields: ['appealId'] }] }
  );
  return AppealNote;
};
