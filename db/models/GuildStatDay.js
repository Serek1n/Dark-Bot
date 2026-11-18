const { DataTypes, Model } = require('sequelize');

// «Статистика сервера»: the numbers of one server for one day (the day in STATS_TZ, Moscow by default). Counted in memory
// by bot/modules/serverStats.js and added here once a minute.
module.exports = (sequelize) => {
  class GuildStatDay extends Model {}
  GuildStatDay.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      day: { type: DataTypes.STRING(10), allowNull: false }, // YYYY-MM-DD
      members: { type: DataTypes.INTEGER, defaultValue: 0 }, // members at the last count of the day
      joins: { type: DataTypes.INTEGER, defaultValue: 0 },
      leaves: { type: DataTypes.INTEGER, defaultValue: 0 },
      messages: { type: DataTypes.INTEGER, defaultValue: 0 },
      voiceMinutes: { type: DataTypes.INTEGER, defaultValue: 0 }, // member-minutes in voice (not bots, not AFK)
      voicePeak: { type: DataTypes.INTEGER, defaultValue: 0 }, // most people in voice at once
      onlinePeak: { type: DataTypes.INTEGER, defaultValue: 0 } // most members online at once (when it was asked)
    },
    { sequelize, modelName: 'GuildStatDay', tableName: 'guild_stat_days', timestamps: false, indexes: [{ unique: true, fields: ['guildId', 'day'] }] }
  );
  return GuildStatDay;
};
