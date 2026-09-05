const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Alert extends Model {}

  Alert.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false }, // where to post
      platform: { type: DataTypes.ENUM('youtube', 'twitch'), allowNull: false },
      targetId: { type: DataTypes.STRING, allowNull: false }, // YouTube channel ID or Twitch login
      targetName: { type: DataTypes.STRING, allowNull: true }, // display name (resolved)
      message: { type: DataTypes.STRING, defaultValue: '{name} только что опубликовал(а) новое видео/начал(а) стрим! {url}' },
      lastSeenId: { type: DataTypes.STRING, allowNull: true }, // last video id / stream id already announced
      isLive: { type: DataTypes.BOOLEAN, defaultValue: false }
    },
    {
      sequelize,
      modelName: 'Alert',
      tableName: 'alerts',
      indexes: [{ unique: true, fields: ['guildId', 'platform', 'targetId', 'channelId'] }]
    }
  );

  return Alert;
};
