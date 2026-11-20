const { DataTypes, Model } = require('sequelize');

// A person's own choices that hold on every server: for now — no optional private messages from the bot (level-ups,
// achievements, reminders that a temporary role ended…). Messages about his own punishment or appeal still come.
module.exports = (sequelize) => {
  class UserPref extends Model {}
  UserPref.init(
    {
      userId: { type: DataTypes.STRING, primaryKey: true },
      dmOff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    },
    { sequelize, modelName: 'UserPref', tableName: 'user_prefs' }
  );
  return UserPref;
};
