const { DataTypes, Model } = require('sequelize');

// A server in the public catalog «Сообщества». status: published | pending (waits for the platform's moderators) | hidden
// (by its owner) | blocked (by the platform; the owner can't publish it again).
module.exports = (sequelize) => {
  class Community extends Model {}
  Community.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false, unique: true },
      ownerId: { type: DataTypes.STRING, allowNull: false }, // who listed it
      name: { type: DataTypes.STRING(60), allowNull: false },
      shortDesc: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      categories: { type: DataTypes.STRING(120), defaultValue: '' },
      tags: { type: DataTypes.STRING(200), defaultValue: '' },
      inviteUrl: { type: DataTypes.STRING(120), allowNull: false },
      iconHash: { type: DataTypes.STRING(80), allowNull: true },
      bannerUrl: { type: DataTypes.STRING(300), allowNull: true },
      memberCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      status: { type: DataTypes.STRING(12), defaultValue: 'published' },
      moderationNote: { type: DataTypes.STRING(300), allowNull: true },
      votes: { type: DataTypes.INTEGER, defaultValue: 0 },
      views: { type: DataTypes.INTEGER, defaultValue: 0 },
      clicks: { type: DataTypes.INTEGER, defaultValue: 0 },
      bumpedAt: { type: DataTypes.DATE, allowNull: true },
      ratingSum: { type: DataTypes.INTEGER, defaultValue: 0 }, // marks of the published reviews, added up
      ratingCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      rules: { type: DataTypes.TEXT, allowNull: true }, // the server's rules, one per line
      links: { type: DataTypes.TEXT, allowNull: true }, // JSON: [{ label, url }] — site, YouTube, Telegram…
      gallery: { type: DataTypes.TEXT, allowNull: true }, // JSON: [url] — up to 6 screenshots
      notifyChannelId: { type: DataTypes.STRING, allowNull: true }, // where the bot tells about new reviews
      publishedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'Community', tableName: 'communities', indexes: [{ fields: ['status'] }] }
  );
  return Community;
};
