const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ReactionRole extends Model {}

  ReactionRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false },
      emoji: { type: DataTypes.STRING, allowNull: false }, // unicode emoji or custom emoji id
      roleId: { type: DataTypes.STRING, allowNull: false },
      // more roles for the same reaction (JSON array, up to 4), and the mode: normal | single (one item of the message at a time)
      // | reverse (the reaction takes the roles away, removing it gives them back)
      extraRoleIds: { type: DataTypes.TEXT, allowNull: true },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'normal' }
    },
    {
      sequelize,
      modelName: 'ReactionRole',
      tableName: 'reaction_roles',
      indexes: [{ unique: true, fields: ['messageId', 'emoji'] }]
    }
  );

  return ReactionRole;
};
