const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TempVoiceChannel extends Model {}

  TempVoiceChannel.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false, unique: true },
      ownerId: { type: DataTypes.STRING, allowNull: false }
    },
    { sequelize, modelName: 'TempVoiceChannel', tableName: 'temp_voice_channels' }
  );

  return TempVoiceChannel;
};
