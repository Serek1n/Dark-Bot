const { DataTypes, Model } = require('sequelize');

// What an owner set up in his temporary room last time (name, limit, access, bitrate, region, his trusted and banned
// people): his next room is created the same way — "настройки запоминаются для следующего раза".
module.exports = (sequelize) => {
  class VoiceRoomPref extends Model {}
  VoiceRoomPref.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: true },
      userLimit: { type: DataTypes.INTEGER, allowNull: true },
      access: { type: DataTypes.STRING, allowNull: true },
      bitrate: { type: DataTypes.INTEGER, allowNull: true }, // kbps
      region: { type: DataTypes.STRING, allowNull: true },
      trusted: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' }, // the white list
      banned: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' } // the black list
    },
    { sequelize, modelName: 'VoiceRoomPref', tableName: 'voice_room_prefs', indexes: [{ unique: true, fields: ['guildId', 'userId'] }] }
  );
  return VoiceRoomPref;
};
