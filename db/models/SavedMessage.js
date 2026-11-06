const { DataTypes, Model } = require('sequelize');

// Messages kept in the panel's builder (Сообщения → Сохранённые): the editor's whole state as JSON.
module.exports = (sequelize) => {
  class SavedMessage extends Model {}
  SavedMessage.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      data: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' },
      createdBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'SavedMessage', tableName: 'saved_messages', indexes: [{ fields: ['guildId'] }] }
  );
  return SavedMessage;
};
