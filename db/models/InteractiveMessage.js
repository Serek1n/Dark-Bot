const { DataTypes, Model } = require('sequelize');

// "Интерактивное сообщение": a message from the bot with buttons or a drop-down list that give, take or toggle roles.
// items: [{ label, emoji, style, description, roleIds: [] }] (up to 25); mode: toggle | add | remove; exclusive: one item at a time.
module.exports = (sequelize) => {
  class InteractiveMessage extends Model {}
  InteractiveMessage.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: true },
      content: { type: DataTypes.TEXT, allowNull: false },
      kind: { type: DataTypes.STRING, allowNull: false, defaultValue: 'buttons' }, // buttons | select
      placeholder: { type: DataTypes.STRING, allowNull: true },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'toggle' },
      exclusive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      items: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
      createdBy: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'InteractiveMessage', tableName: 'interactive_messages', indexes: [{ fields: ['guildId'] }] }
  );
  return InteractiveMessage;
};
