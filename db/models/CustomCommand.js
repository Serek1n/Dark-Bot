const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CustomCommand extends Model {}

  CustomCommand.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      trigger: { type: DataTypes.STRING, allowNull: false },
      response: { type: DataTypes.TEXT, allowNull: false }, // may be '' when the answer is only an embed
      embed: { type: DataTypes.TEXT, allowNull: true }, // message editor: the embed part
      createdBy: { type: DataTypes.STRING, allowNull: false }
    },
    {
      sequelize,
      modelName: 'CustomCommand',
      tableName: 'custom_commands',
      indexes: [{ unique: true, fields: ['guildId', 'trigger'] }]
    }
  );

  return CustomCommand;
};
