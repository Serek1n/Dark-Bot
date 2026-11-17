const { DataTypes, Model } = require('sequelize');

// What happened to temporary rooms: created, renamed, closed, someone banned or kicked, handed over, deleted.
module.exports = (sequelize) => {
  class VoiceRoomLog extends Model {}
  VoiceRoomLog.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: true },
      roomName: { type: DataTypes.STRING(100), allowNull: true },
      actorId: { type: DataTypes.STRING, allowNull: true }, // null: the bot itself
      action: { type: DataTypes.STRING, allowNull: false },
      targetId: { type: DataTypes.STRING, allowNull: true },
      details: { type: DataTypes.STRING(300), allowNull: true }
    },
    { sequelize, modelName: 'VoiceRoomLog', tableName: 'voice_room_logs', updatedAt: false, indexes: [{ fields: ['guildId', 'createdAt'] }, { fields: ['guildId', 'action'] }] }
  );
  return VoiceRoomLog;
};
