// Personal playlists: create, rename, delete, add and remove tracks, change the order, play (in order or shuffled), share
// with a code, import from YouTube / SoundCloud / Spotify / Apple Music, save the current queue. Used by /playlist and the
// panel. Every change checks the owner; the order is kept with plain positions, rewritten in one transaction.
const crypto = require('crypto');
const { Playlist, PlaylistTrack, sequelize } = require('../../../db');

const MAX_PLAYLISTS = 25; // per person
const MAX_TRACKS = 500; // per playlist
const NAME_MAX = 60;

class PlaylistError extends Error {}
const fail = (text) => { throw new PlaylistError(text); };

const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** The person's playlists with their track counts. */
async function listOf(ownerId) {
  const rows = await Playlist.findAll({ where: { ownerId }, order: [['name', 'ASC']] });
  const counts = rows.length ? await sequelize.query(`SELECT playlistId, COUNT(*) AS n FROM playlist_tracks WHERE playlistId IN (${rows.map(() => '?').join(',')}) GROUP BY playlistId`, { replacements: rows.map((r) => r.id), type: sequelize.QueryTypes.SELECT }) : [];
  const byId = new Map(counts.map((c) => [Number(c.playlistId), Number(c.n)]));
  return rows.map((p) => ({ id: p.id, name: p.name, shareCode: p.shareCode, plays: p.plays, source: p.source, count: byId.get(p.id) || 0, updatedAt: p.updatedAt }));
}

/** A playlist of this person by name (case does not matter) or by id; throws when there is none. */
async function own(ownerId, nameOrId) {
  const id = Number(nameOrId);
  let p = null;
  if (Number.isInteger(id) && id > 0 && String(id) === String(nameOrId).trim()) p = await Playlist.findOne({ where: { id, ownerId } });
  // at most 25 per person: comparing names without case in JS also works for Cyrillic (SQLite's lower() does not)
  if (!p) p = (await Playlist.findAll({ where: { ownerId } })).find((x) => x.name.toLowerCase() === cleanName(nameOrId).toLowerCase()) || null;
  if (!p) fail(`У вас нет плейлиста «${cleanName(nameOrId)}». Список: /playlist list`);
  return p;
}

/** A playlist to play: your own by name, or anyone's shared one by its code. */
async function playable(viewerId, nameOrCode) {
  const code = String(nameOrCode || '').trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(code)) {
    const shared = await Playlist.findOne({ where: { shareCode: code } });
    if (shared) return shared;
  }
  return own(viewerId, nameOrCode);
}

async function create(ownerId, name, { source = null } = {}) {
  name = cleanName(name);
  if (!name) fail('Назовите плейлист.');
  if ((await Playlist.count({ where: { ownerId } })) >= MAX_PLAYLISTS) fail(`Можно иметь не больше ${MAX_PLAYLISTS} плейлистов. Удалите ненужный: /playlist delete`);
  if ((await Playlist.findAll({ where: { ownerId } })).some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(`Плейлист «${name}» уже есть.`);
  return Playlist.create({ ownerId, name, source });
}

async function rename(ownerId, nameOrId, newName) {
  const p = await own(ownerId, nameOrId);
  newName = cleanName(newName);
  if (!newName) fail('Новое название пустое.');
  if ((await Playlist.findAll({ where: { ownerId } })).some((x) => x.id !== p.id && x.name.toLowerCase() === newName.toLowerCase())) fail(`Плейлист «${newName}» уже есть.`);
  await p.update({ name: newName });
  return p;
}

async function remove(ownerId, nameOrId) {
  const p = await own(ownerId, nameOrId);
  await sequelize.transaction(async (t) => {
    await PlaylistTrack.destroy({ where: { playlistId: p.id }, transaction: t });
    await p.destroy({ transaction: t });
  });
  return p;
}

const tracksOf = (playlistId) => PlaylistTrack.findAll({ where: { playlistId }, order: [['position', 'ASC'], ['id', 'ASC']] });

/** Player tracks → rows (a track found by name keeps its query). Returns how many were added. */
async function addTracks(ownerId, nameOrId, tracks) {
  const p = await own(ownerId, nameOrId);
  const have = await PlaylistTrack.count({ where: { playlistId: p.id } });
  const room = MAX_TRACKS - have;
  if (room <= 0) fail(`В плейлисте уже ${MAX_TRACKS} треков — это предел.`);
  const rows = tracks.slice(0, room).map((t, i) => ({
    playlistId: p.id, position: have + i, title: String(t.title || 'Без названия').slice(0, 300),
    url: t.lazy ? (t.url || null) : t.url || null, source: t.lazy ? 'search' : t.source || 'youtube',
    durationSec: Number(t.durationSec) || require('./player').parseDurationSec(t.duration) || 0,
    thumbnail: t.thumbnail ? String(t.thumbnail).slice(0, 500) : null, query: t.lazy ? String(t.query || t.title).slice(0, 300) : null
  }));
  await PlaylistTrack.bulkCreate(rows);
  await p.changed('updatedAt', true); await p.save();
  return { playlist: p, added: rows.length, cut: tracks.length - rows.length };
}

/** Rewrites the positions 0..n-1 in the given order (one transaction). */
async function renumber(rows, t) {
  for (let i = 0; i < rows.length; i++) if (rows[i].position !== i) await rows[i].update({ position: i }, { transaction: t });
}

/** Removes the track at `number` (1-based, as /playlist show lists them). */
async function removeTrack(ownerId, nameOrId, number) {
  const p = await own(ownerId, nameOrId);
  const rows = await tracksOf(p.id);
  const i = Number(number) - 1;
  if (!(i >= 0 && i < rows.length)) fail(`В плейлисте нет трека №${number}. Всего: ${rows.length}.`);
  const [gone] = rows.splice(i, 1);
  await sequelize.transaction(async (t) => { await gone.destroy({ transaction: t }); await renumber(rows, t); });
  return gone;
}

/** Moves a track from position `from` to position `to` (both 1-based). */
async function moveTrack(ownerId, nameOrId, from, to) {
  const p = await own(ownerId, nameOrId);
  const rows = await tracksOf(p.id);
  const a = Number(from) - 1; const b = Number(to) - 1;
  if (!(a >= 0 && a < rows.length) || !(b >= 0 && b < rows.length)) fail(`Номера треков — от 1 до ${rows.length}.`);
  const [x] = rows.splice(a, 1);
  rows.splice(b, 0, x);
  await sequelize.transaction((t) => renumber(rows, t));
  return x;
}

/** Turns sharing on (a new 8-character code) or off. Returns the code or null. */
async function share(ownerId, nameOrId, on = true) {
  const p = await own(ownerId, nameOrId);
  if (!on) { await p.update({ shareCode: null }); return null; }
  if (p.shareCode) return p.shareCode;
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8).padEnd(8, 'X');
    try { await p.update({ shareCode: code }); return code; } catch { /* taken: try another */ }
  }
  fail('Не получилось создать код. Попробуйте ещё раз.');
}

/** Copies a shared playlist into the person's own list. */
async function copyShared(ownerId, code, name) {
  const src = await Playlist.findOne({ where: { shareCode: String(code || '').trim().toUpperCase() } });
  if (!src) fail('Плейлиста с таким кодом нет (или владелец закрыл доступ).');
  const p = await create(ownerId, name || src.name);
  const rows = await tracksOf(src.id);
  await PlaylistTrack.bulkCreate(rows.map((r, i) => ({ playlistId: p.id, position: i, title: r.title, url: r.url, source: r.source, durationSec: r.durationSec, thumbnail: r.thumbnail, query: r.query })));
  return { playlist: p, count: rows.length };
}

/** Rows → tracks for the player (a name-only track stays "lazy" and is found on YouTube right before it plays). */
function toPlayerTracks(rows, requestedBy) {
  const { formatSeconds } = require('./player');
  return rows.map((r) => ({
    title: r.title, url: r.url, source: r.source === 'search' ? 'search' : r.source, durationSec: r.durationSec || 0,
    duration: r.durationSec ? formatSeconds(r.durationSec) : '—', thumbnail: r.thumbnail, requestedBy,
    ...(r.source === 'search' || !r.url ? { lazy: true, query: r.query || r.title, from: 'playlist' } : {})
  }));
}

/** Everything the player needs to play a playlist: { playlist, tracks } (order kept, or shuffled). */
async function forPlaying(viewerId, nameOrCode, { shuffle = false } = {}) {
  const p = await playable(viewerId, nameOrCode);
  const tracks = toPlayerTracks(await tracksOf(p.id), viewerId);
  if (!tracks.length) fail(`Плейлист «${p.name}» пуст. Добавьте треки: /playlist add`);
  if (shuffle) for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
  await Playlist.increment('plays', { where: { id: p.id } });
  return { playlist: { id: p.id, name: p.name, tracks: toPlayerTracks(await tracksOf(p.id), viewerId), shuffle }, tracks };
}

module.exports = { listOf, own, playable, create, rename, remove, tracksOf, addTracks, removeTrack, moveTrack, share, copyShared, toPlayerTracks, forPlaying, PlaylistError, MAX_PLAYLISTS, MAX_TRACKS, cleanName };
