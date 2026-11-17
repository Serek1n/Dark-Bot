const { DataTypes, Model } = require('sequelize');

// A member's own playlist: it belongs to the person, not to a server, so it plays on any server with the bot.
// `shareCode` (when set) lets others play and copy it: /playlist play code:XXXX.
module.exports = (sequelize) => {
  class Playlist extends Model {}
  Playlist.init(
    {
      ownerId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(60), allowNull: false },
      shareCode: { type: DataTypes.STRING(12), allowNull: true, unique: true },
      plays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      source: { type: DataTypes.STRING, allowNull: true } // where it was imported from (a link), or null
    },
    { sequelize, modelName: 'Playlist', tableName: 'playlists', indexes: [{ unique: true, fields: ['ownerId', 'name'] }] }
  );
  return Playlist;
};
