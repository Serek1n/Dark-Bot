const { DataTypes, Model } = require('sequelize');

// A way onto the appeal server for one punished person (bot/modules/appealGuild.js).
// status: requested (waits for a moderator) → issued (a personal one-use invite) → joined → closed;
// requested → rejected; issued → expired (its invite ran out unused; seen lazily by expiresAt).
module.exports = (sequelize) => {
  class AppealGuildPass extends Model {}
  AppealGuildPass.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false }, // the main server, where the punishment is
      userId: { type: DataTypes.STRING, allowNull: false },
      appealGuildId: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING(10), allowNull: true },
      caseNumber: { type: DataTypes.INTEGER, allowNull: true },
      appealId: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.STRING(10), defaultValue: 'requested' },
      comment: { type: DataTypes.STRING(300), allowNull: true }, // the person's words with the request
      inviteCode: { type: DataTypes.STRING(40), allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      approvedBy: { type: DataTypes.STRING, allowNull: true },
      decisionReason: { type: DataTypes.STRING(300), allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      shownAt: { type: DataTypes.DATE, allowNull: true }, // the site showed the invite (once, for closed DMs)
      joinedAt: { type: DataTypes.DATE, allowNull: true },
      threadId: { type: DataTypes.STRING, allowNull: true },
      modChannelId: { type: DataTypes.STRING, allowNull: true }, // the request's message with the buttons
      modMessageId: { type: DataTypes.STRING, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'AppealGuildPass', tableName: 'appeal_guild_passes', indexes: [{ fields: ['guildId', 'status'] }, { fields: ['userId'] }, { fields: ['appealGuildId', 'userId'] }] }
  );
  return AppealGuildPass;
};
