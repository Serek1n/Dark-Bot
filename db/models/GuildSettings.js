const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class GuildSettings extends Model {}

  GuildSettings.init(
    {
      guildId: { type: DataTypes.STRING, primaryKey: true },
      // Set when the bot was removed from the server; everything is kept for 14 days (see guildBackup.js)
      leftAt: { type: DataTypes.DATE, allowNull: true },
      prefix: { type: DataTypes.STRING, defaultValue: '!' },

      // Logging
      modLogChannelId: { type: DataTypes.STRING, allowNull: true },
      reportChannelId: { type: DataTypes.STRING, allowNull: true },
      levelUpChannelId: { type: DataTypes.STRING, allowNull: true },
      levelUpInVoice: { type: DataTypes.BOOLEAN, defaultValue: true }, // a member in a voice channel gets the level-up message in that channel's chat

      // Forum "Логи": a webhook posts into one thread per event kind (see bot/utils/logCategories.js)
      logForumChannelId: { type: DataTypes.STRING, allowNull: true },
      logWebhookId: { type: DataTypes.STRING, allowNull: true },
      logWebhookToken: { type: DataTypes.STRING, allowNull: true },
      logThreads: { type: DataTypes.TEXT, defaultValue: '{}' }, // JSON { category: threadId }
      logDisabled: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON [category] switched off

      // Welcome / autorole
      welcomeChannelId: { type: DataTypes.STRING, allowNull: true },
      welcomeMessage: { type: DataTypes.STRING, defaultValue: 'Добро пожаловать, {user}, на сервере **{server}**!' },
      autoRoleId: { type: DataTypes.STRING, allowNull: true },
      welcomeCard: { type: DataTypes.BOOLEAN, defaultValue: false }, // attach a picture card to the welcome message
      leaveChannelId: { type: DataTypes.STRING, allowNull: true }, // farewell message when a member leaves
      leaveMessage: { type: DataTypes.STRING, defaultValue: '**{user}** покинул(а) сервер. Нас осталось {count}.' },

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

      // Feature switches (web panel, page "Функции"); leveling/shop/automod have their own flags above and below
      economyEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      musicEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      welcomeEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      reactionRolesEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      customCommandsEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      tempVoiceEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      alertsEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      reportEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      pollsEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      giveawaysEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      ticketsEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      remindersEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      webhooksEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      // Roles and nickname come back when a member who left joins again
      restoreOnRejoin: { type: DataTypes.BOOLEAN, defaultValue: true },
      restoreDays: { type: DataTypes.INTEGER, defaultValue: 365 },
      restoreStaffRoles: { type: DataTypes.BOOLEAN, defaultValue: false },
      funEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },

      // Tickets: a button makes a private channel with the staff (see bot/modules/tickets.js)
      ticketCategoryId: { type: DataTypes.STRING, allowNull: true },
      ticketSupportRoleId: { type: DataTypes.STRING, allowNull: true },
      ticketLogChannelId: { type: DataTypes.STRING, allowNull: true },
      ticketMessage: { type: DataTypes.STRING, defaultValue: 'Опишите вашу проблему, и скоро вам ответит команда сервера.' },

      // Automod
      automodEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodBannedWords: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array
      automodBlockInvites: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodAntiSpam: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodSpamMessages: { type: DataTypes.INTEGER, defaultValue: 5 }, // messages
      automodSpamSeconds: { type: DataTypes.INTEGER, defaultValue: 7 }, // within N seconds
      automodAction: { type: DataTypes.STRING, defaultValue: 'delete' }, // delete | warn | mute (the message is always deleted)
      automodMuteMinutes: { type: DataTypes.INTEGER, defaultValue: 10 },
      automodMentionLimit: { type: DataTypes.INTEGER, defaultValue: 0 }, // 0 = off
      automodCapsPercent: { type: DataTypes.INTEGER, defaultValue: 0 }, // 0 = off
      automodCapsMinLength: { type: DataTypes.INTEGER, defaultValue: 10 },
      automodBlockLinks: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodLinkWhitelist: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array of domains
      automodEmojiLimit: { type: DataTypes.INTEGER, defaultValue: 0 }, // 0 = off
      automodDuplicates: { type: DataTypes.BOOLEAN, defaultValue: false },
      automodProfanity: { type: DataTypes.BOOLEAN, defaultValue: false }, // the built-in list of obscene words
      automodZalgo: { type: DataTypes.BOOLEAN, defaultValue: false }, // "z̷a̸l̶g̵o̷" text with piles of combining marks
      automodIgnoredChannels: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array of channel ids
      automodIgnoredRoles: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array of role ids

      // Moderation (/mod): see bot/modules/moderation.js
      modDmEnabled: { type: DataTypes.BOOLEAN, defaultValue: true }, // tell the member about a punishment in DMs
      modRequireReason: { type: DataTypes.BOOLEAN, defaultValue: false },
      modWarnExpireDays: { type: DataTypes.INTEGER, defaultValue: 0 }, // 0 = warnings never expire
      modWarnThresholds: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON [{ count, action: mute|kick|ban, minutes }]

      // Channel bonuses: JSON { "<channel or category id>": { xp: 2, coins: 1.5 } }, see bot/modules/leveling.js
      channelBoosts: { type: DataTypes.TEXT, defaultValue: '{}' },

      // Temp voice ("join to create")
      tempVoiceJoinChannelId: { type: DataTypes.STRING, allowNull: true },
      tempVoiceCategoryId: { type: DataTypes.STRING, allowNull: true },
      tempVoiceNameTemplate: { type: DataTypes.STRING, defaultValue: 'Комната {user}' },
      tempVoicePanelChannelId: { type: DataTypes.STRING, allowNull: true }, // where the room control panel (buttons) was posted
      tempVoicePanelMessageId: { type: DataTypes.STRING, allowNull: true },
      webhookPanelChannelId: { type: DataTypes.STRING, allowNull: true }, // where the webhook control panel (buttons) was posted
      webhookPanelMessageId: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'GuildSettings', tableName: 'guild_settings' }
  );

  return GuildSettings;
};
