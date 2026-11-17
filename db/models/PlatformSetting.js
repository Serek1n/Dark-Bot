const { DataTypes, Model } = require('sequelize');

// Settings of the DARK platform itself (not of a server): prices of promotion, pre-moderation of the catalog. Only the
// platform owners (BOT_OWNER_IDS) change them, on /platform.
module.exports = (sequelize) => {
  class PlatformSetting extends Model {}
  PlatformSetting.init(
    {
      key: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      value: { type: DataTypes.TEXT, allowNull: true }
    },
    { sequelize, modelName: 'PlatformSetting', tableName: 'platform_settings' }
  );
  return PlatformSetting;
};
