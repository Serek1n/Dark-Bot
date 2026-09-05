const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ReactionRole extends Model {}

  ReactionRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false },
      emoji: { type: DataTypes.STRING, allowNull: false }, // unicode emoji or custom emoji id
      roleId: { type: DataTypes.STRING, allowNull: false }
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
