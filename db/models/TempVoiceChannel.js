const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TempVoiceChannel extends Model {}

  TempVoiceChannel.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false, unique: true },
      ownerId: { type: DataTypes.STRING, allowNull: false },
      access: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' }, // open | locked | hidden
      lockState: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' } // roles whose own overwrite was switched off by a lock, to give it back on opening
    },
    { sequelize, modelName: 'TempVoiceChannel', tableName: 'temp_voice_channels' }
  );

  return TempVoiceChannel;
};
