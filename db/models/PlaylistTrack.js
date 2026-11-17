const { DataTypes, Model } = require('sequelize');

// A track of a playlist, in order (`position` 0, 1, 2...). A track known by name only (from Spotify or Apple Music) keeps
// `query` and is found on YouTube when it is about to play.
module.exports = (sequelize) => {
  class PlaylistTrack extends Model {}
  PlaylistTrack.init(
    {
      playlistId: { type: DataTypes.INTEGER, allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING(300), allowNull: false },
      url: { type: DataTypes.STRING(500), allowNull: true },
      source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'youtube' },
      durationSec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      thumbnail: { type: DataTypes.STRING(500), allowNull: true },
      query: { type: DataTypes.STRING(300), allowNull: true }
    },
    { sequelize, modelName: 'PlaylistTrack', tableName: 'playlist_tracks', indexes: [{ fields: ['playlistId', 'position'] }] }
  );
  return PlaylistTrack;
};
