const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CustomCommand extends Model {}

  CustomCommand.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      trigger: { type: DataTypes.STRING, allowNull: false },
      response: { type: DataTypes.TEXT, allowNull: false },
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
