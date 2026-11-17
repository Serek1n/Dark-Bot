const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild } = require('../../discordApi');
const { clampInt, saved, getSettings } = require('../../utils/common');

// «Музыка»: what plays on this server now (with the same controls as the buttons in Discord) and the signed-in person's
// own playlists — create, rename, fill (link or search), reorder, share by code, import, delete.
const router = express.Router();
const pl = () => require('../../../bot/modules/music/playlists');
const player = () => require('../../../bot/modules/music/player');
const back = (req, id, flag) => (id ? `/dashboard/${req.params.guildId}/music/playlist/${id}?${flag}=1` : saved(req.params.guildId, 'music', flag));
const errText = (err) => encodeURIComponent(String(err?.userText || err?.message || 'Ошибка').slice(0, 200));

function nowPlaying(guildId) {
  const q = player().getQueue(guildId);
  if (!q || !q.playing) return null;
  return { title: q.playing.title, url: q.playing.url, thumbnail: q.playing.thumbnail, duration: q.playing.duration, position: q.position(), durationSec: q.playing.durationSec || player().parseDurationSec(q.playing.duration),
    requestedBy: q.playing.requestedBy, paused: q.paused, loop: q.loop, volume: Math.round(q.volume * 100), channel: q.voiceChannel?.name, playlist: q.playlist?.name || null,
    next: q.tracks.slice(0, 15).map((t) => ({ title: t.title, duration: t.duration })), more: Math.max(0, q.tracks.length - 15), total: q.tracks.length };
}

router.get('/:guildId/music', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  const mine = req.user?.id ? await pl().listOf(req.user.id) : [];
  res.render('dashboard/music', { guild, settings, now: nowPlaying(req.params.guildId), mine, max: pl().MAX_PLAYLISTS, spotifyKeys: require('../../../bot/modules/music/spotify').hasKeys(), fail: String(req.query.fail || '').slice(0, 200), active: 'music' });
});

// The player's controls from the panel (the same as the buttons under the player in Discord).
router.post('/:guildId/music/control', ensureGuildAccess, async (req, res) => {
  const q = player().getQueue(req.params.guildId);
  if (!q || !q.playing) return res.redirect(saved(req.params.guildId, 'music', 'notplaying'));
  const a = String(req.body.action || '');
  if (a === 'skip') q.skip();
  else if (a === 'toggle') { if (q.paused) q.resume(); else q.pause(); }
  else if (a === 'shuffle') q.shuffle();
  else if (a === 'stop') player().destroyQueue(req.params.guildId, 'Остановлено из панели.');
  else if (a === 'loop') { if (!q.setLoop(String(req.body.mode))) return res.redirect(saved(req.params.guildId, 'music', 'invalid')); }
  else if (a === 'volume') q.setVolume(clampInt(req.body.volume, 0, 150, 50) / 100);
  else return res.redirect(saved(req.params.guildId, 'music', 'invalid'));
  if (a !== 'stop' && a !== 'skip') q.refreshPanel();
  res.redirect(saved(req.params.guildId, 'music', 'musicok'));
});

// ---- personal playlists (always the signed-in person's own) ----
const mustUser = (req, res) => { if (!req.user?.id) { res.redirect(saved(req.params.guildId, 'music', 'invalid')); return false; } return true; };

router.post('/:guildId/music/playlists', ensureGuildAccess, async (req, res) => {
  if (!mustUser(req, res)) return;
  try {
    const p = await pl().create(req.user.id, req.body.name);
    res.redirect(back(req, p.id, 'saved'));
  } catch (err) { res.redirect(`/dashboard/${req.params.guildId}/music?fail=${errText(err)}`); }
});

// Import a playlist or album by link: names now, YouTube links when each track plays.
router.post('/:guildId/music/import', ensureGuildAccess, async (req, res) => {
  if (!mustUser(req, res)) return;
  const url = String(req.body.url || '').trim().slice(0, 300);
  try {
    if (!/^https?:\/\//i.test(url) && !/^spotify:/i.test(url)) throw new Error('Нужна ссылка на плейлист или альбом.');
    const tracks = await player().resolveQuery(url, req.user.id);
    if (!tracks.length) throw new Error('По ссылке ничего не нашлось.');
    const p = await pl().create(req.user.id, req.body.name || tracks.meta?.name || 'Импорт', { source: url.slice(0, 250) });
    await pl().addTracks(req.user.id, p.id, tracks);
    res.redirect(back(req, p.id, 'imported'));
  } catch (err) { res.redirect(`/dashboard/${req.params.guildId}/music?fail=${errText(err)}`); }
});

async function ownPlaylist(req) {
  return pl().own(req.user?.id || '-', String(clampInt(req.params.id, 1, 2147483647, 0)));
}

router.get('/:guildId/music/playlist/:id', ensureGuildAccess, async (req, res) => {
  const [guild, settings] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId)]);
  let p;
  try { p = await ownPlaylist(req); } catch { return res.status(404).render('error', { message: 'Плейлист не найден.' }); }
  const rows = await pl().tracksOf(p.id);
  res.render('dashboard/music-playlist', { guild, settings, p, rows, fmt: player().formatSeconds, max: pl().MAX_TRACKS, fail: String(req.query.fail || '').slice(0, 200), active: 'music' });
});

router.post('/:guildId/music/playlist/:id/:action', ensureGuildAccess, async (req, res) => {
  if (!mustUser(req, res)) return;
  const id = clampInt(req.params.id, 1, 2147483647, 0);
  const me = req.user.id;
  try {
    const p = await ownPlaylist(req);
    const a = req.params.action;
    if (a === 'rename') await pl().rename(me, String(p.id), req.body.name);
    else if (a === 'delete') { await pl().remove(me, String(p.id)); return res.redirect(saved(req.params.guildId, 'music', 'deleted')); }
    else if (a === 'share') await pl().share(me, String(p.id), req.body.on === '1');
    else if (a === 'remove') await pl().removeTrack(me, String(p.id), clampInt(req.body.number, 1, 1000, 0));
    else if (a === 'move') await pl().moveTrack(me, String(p.id), clampInt(req.body.from, 1, 1000, 0), clampInt(req.body.to, 1, 1000, 0));
    else if (a === 'add') {
      const q = String(req.body.query || '').trim().slice(0, 300);
      if (!q) throw new Error('Укажите ссылку или название.');
      const tracks = await player().resolveQuery(q, me);
      if (!tracks.length) throw new Error('Ничего не найдено.');
      const isList = tracks.length > 1 && /list=|playlist|album|sets\//i.test(q);
      await pl().addTracks(me, String(p.id), isList ? tracks : tracks.slice(0, 1));
    } else return res.redirect(back(req, id, 'invalid'));
    res.redirect(back(req, id, 'saved'));
  } catch (err) { res.redirect(`/dashboard/${req.params.guildId}/music/playlist/${id}?fail=${errText(err)}`); }
});

module.exports = router;
