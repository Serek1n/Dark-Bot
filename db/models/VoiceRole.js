const { DataTypes, Model } = require('sequelize');

// "Голосовая роль": held while the member sits in a voice channel (a chosen one, or any when channelId is null).
module.exports = (sequelize) => {
  class VoiceRole extends Model {}
  VoiceRole.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      roleId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'VoiceRole', tableName: 'voice_roles', indexes: [{ fields: ['guildId'] }, { unique: true, fields: ['guildId', 'roleId', 'channelId'] }] }
  );
  return VoiceRole;
};
