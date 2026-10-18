const { DataTypes, Model } = require('sequelize');

// What a member had when he left the server (roles, nickname), kept so it can be given back if he returns.
// XP, level, wallet, purchases and warnings never needed this: they stay in their own tables.
module.exports = (sequelize) => {
  class MemberSnapshot extends Model {}
  MemberSnapshot.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      roleIds: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' }, // JSON array of role ids
      nickname: { type: DataTypes.STRING, allowNull: true },
      mutedUntil: { type: DataTypes.DATE, allowNull: true }, // a timeout still running when he left: leaving does not end a punishment
      leftAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    { sequelize, modelName: 'MemberSnapshot', tableName: 'member_snapshots', indexes: [{ unique: true, fields: ['guildId', 'userId'] }, { fields: ['leftAt'] }] }
  );
  return MemberSnapshot;
};
