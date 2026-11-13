const { DataTypes, Model } = require('sequelize');

// The economy's journal: every coin or crystal that comes or goes, except the small steady income (chat, voice, levels), which
// is summed per member per day in economy_earn. kind: daily, pay_in, pay_out, shop, refund, giveaway, admin, tax, goal,
// goal_refund, deal_hold, deal_in, deal_refund, work, gift_out, gift_in, hold_out, hold_in, hold_back, season, treasury.
module.exports = (sequelize) => {
  class EconomyTx extends Model {}
  EconomyTx.init(
    {
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'coins' }, // coins | crystals
      amount: { type: DataTypes.INTEGER, allowNull: false }, // + came in, − went out
      kind: { type: DataTypes.STRING, allowNull: false },
      otherId: { type: DataTypes.STRING, allowNull: true }, // the other member of a transfer or a deal
      note: { type: DataTypes.STRING, allowNull: true },
      flag: { type: DataTypes.STRING, allowNull: true } // 'newbie': the sender is new on the server (suspicious chains)
    },
    {
      sequelize, modelName: 'EconomyTx', tableName: 'economy_tx', updatedAt: false,
      indexes: [{ fields: ['guildId', 'createdAt'] }, { fields: ['guildId', 'userId', 'createdAt'] }, { fields: ['guildId', 'kind', 'createdAt'] }]
    }
  );
  return EconomyTx;
};
