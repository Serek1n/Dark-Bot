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
      levelingEnabled: { type: DataTypes.BOOLEAN, defaultValue: true }, // master switch for levels + economy income
      chatEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      voiceEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      xpPerMessageMin: { type: DataTypes.INTEGER, defaultValue: 10 },
      xpPerMessageMax: { type: DataTypes.INTEGER, defaultValue: 20 },
      xpCooldownSeconds: { type: DataTypes.INTEGER, defaultValue: 60 },
      levelRolesReplace: { type: DataTypes.BOOLEAN, defaultValue: false }, // true = keep only the highest level role
      voiceXpPerMinute: { type: DataTypes.INTEGER, defaultValue: 10 }, // 0 = no XP for voice
      voiceMinMembers: { type: DataTypes.INTEGER, defaultValue: 2 }, // people needed in a channel for voice income (1 = also alone)

      // Economy: coins (currencyName) and crystals
      currencyName: { type: DataTypes.STRING, defaultValue: 'монеты' },
      crystalName: { type: DataTypes.STRING, defaultValue: 'кристаллы' },
      chatCoinsPerMessage: { type: DataTypes.INTEGER, defaultValue: 5 },
      voiceCoinsPerMinute: { type: DataTypes.INTEGER, defaultValue: 5 },
      dailyCoins: { type: DataTypes.INTEGER, defaultValue: 100 },
      dailyStreakBonus: { type: DataTypes.INTEGER, defaultValue: 10 }, // extra coins for every day of the streak
      dailyStreakMax: { type: DataTypes.INTEGER, defaultValue: 7 }, // streak days that still add a bonus
      shopEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      shopLogChannelId: { type: DataTypes.STRING, allowNull: true }, // purchases are posted here
      crystalsPerLevel: { type: DataTypes.INTEGER, defaultValue: 1 }, // crystals for every new (single, total) level,

      // Shop
      shopEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      shopLogChannelId: { type: DataTypes.STRING, allowNull: true }, // purchases are announced here (optional)

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
