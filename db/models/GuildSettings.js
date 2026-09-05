const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class GuildSettings extends Model {}

  GuildSettings.init(
    {
      guildId: { type: DataTypes.STRING, primaryKey: true },
      prefix: { type: DataTypes.STRING, defaultValue: '!' },

      // Logging
      modLogChannelId: { type: DataTypes.STRING, allowNull: true },
      reportChannelId: { type: DataTypes.STRING, allowNull: true },
      levelUpChannelId: { type: DataTypes.STRING, allowNull: true },

      // Welcome / autorole
      welcomeChannelId: { type: DataTypes.STRING, allowNull: true },
      welcomeMessage: { type: DataTypes.STRING, defaultValue: 'Добро пожаловать, {user}, на сервере **{server}**!' },
      autoRoleId: { type: DataTypes.STRING, allowNull: true },

      // Leveling
      levelingEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      xpPerMessageMin: { type: DataTypes.INTEGER, defaultValue: 10 },
      xpPerMessageMax: { type: DataTypes.INTEGER, defaultValue: 20 },
      xpCooldownSeconds: { type: DataTypes.INTEGER, defaultValue: 60 },
      currencyName: { type: DataTypes.STRING, defaultValue: 'монеты' },

      // Automod
      automodEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodBannedWords: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array
      automodBlockInvites: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodAntiSpam: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodSpamMessages: { type: DataTypes.INTEGER, defaultValue: 5 }, // messages
      automodSpamSeconds: { type: DataTypes.INTEGER, defaultValue: 7 }, // within N seconds

      // Temp voice ("join to create")
      tempVoiceJoinChannelId: { type: DataTypes.STRING, allowNull: true },
      tempVoiceCategoryId: { type: DataTypes.STRING, allowNull: true },
      tempVoiceNameTemplate: { type: DataTypes.STRING, defaultValue: 'Комната {user}' }
    },
    { sequelize, modelName: 'GuildSettings', tableName: 'guild_settings' }
  );

  return GuildSettings;
};
