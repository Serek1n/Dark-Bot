// Playlists (personal, shared by code, order, limits) and the Spotify link reader (Web API with token renewal, rate limits
// and pages; the public embed page without keys). No network: fetch is replaced.
process.env.DATABASE_PATH = './data/test_playlists.sqlite';
process.env.YTDLP_PATH = require('path').join(__dirname, 'fake-ytdlp.sh'); // a search answers with fake results, no network
try { require('fs').chmodSync(process.env.YTDLP_PATH, 0o755); } catch {}
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const pl = require('../bot/modules/music/playlists');
  const sp = require('../bot/modules/music/spotify');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const throwsText = async (f, re) => { try { await f(); } catch (e) { assert(re.test(e.message), e.message); return; } throw new Error('did not fail'); };
  const tr = (n, extra = {}) => ({ title: `Song ${n}`, url: `https://www.youtube.com/watch?v=${n}`, duration: '3:05', source: 'youtube', ...extra });

  // ---------------- Spotify ----------------
  await test('Spotify links: open.spotify.com (with intl-xx, embed, ?si=), spotify: URIs; others are not', async () => {
    assert(sp.parseSpotifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc').type === 'track', 'track');
    assert(sp.parseSpotifyUrl('https://open.spotify.com/intl-ru/album/1DFixLWuPkv3KT3TnV35m3').type === 'album', 'intl album');
    assert(sp.parseSpotifyUrl('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M').type === 'playlist', 'embed');
    assert(sp.parseSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M').id === '37i9dQZF1DXcBWIGoYBM5M', 'uri');
    assert(!sp.parseSpotifyUrl('https://youtube.com/watch?v=x') && sp.isSpotifyUrl('https://spotify.link/AbCd'), 'others');
  });
  const embedPage = (entity) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;
  await test('without keys: the public embed page gives names, artists, lengths and the cover; unplayable tracks are skipped and counted', async () => {
    delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET;
    const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => embedPage({ name: 'Вечер', coverArt: { sources: [{ url: 'https://i.scdn.co/cover' }] },
      trackList: [{ title: 'Песня', subtitle: 'Артист', duration: 185000 }, { title: 'Закрытая', subtitle: 'X', duration: 1000, isPlayable: false }, { title: 'Вторая', subtitle: 'Б', duration: 200000 }] }), headers: { get: () => null }, url });
    const r = await sp.resolveSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { fetchImpl });
    assert(r.name === 'Вечер' && r.items.length === 2 && r.skipped === 1, JSON.stringify(r));
    assert(r.items[0].title === 'Песня' && r.items[0].artist === 'Артист' && r.items[0].durationSec === 185 && r.items[0].thumbnail === 'https://i.scdn.co/cover', JSON.stringify(r.items[0]));
    await throwsText(() => sp.resolveSpotify('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', { fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }) }), /не найдено/);
  });
  await test('with keys: the Web API; a 401 renews the token once, a 429 waits for Retry-After, playlist pages are followed', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id'; process.env.SPOTIFY_CLIENT_SECRET = 'secret'; sp.resetToken();
    const calls = []; let tokens = 0; let saw401 = false; let saw429 = false;
    const json = (status, body, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: (k) => headers[k] ?? null } });
    const t = (n, extra = {}) => ({ id: `id${n}`, name: `Track ${n}`, duration_ms: 180000 + n * 1000, artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'https://img/' + n }] }, ...extra });
    const fetchImpl = async (url, opt) => {
      calls.push(url);
      if (url.includes('accounts.spotify.com')) { tokens++; return json(200, { access_token: `tok${tokens}`, expires_in: 3600 }); }
      if (!saw401) { saw401 = true; return json(401, {}); }
      if (url.includes('fields=name,images')) return json(200, { name: 'Длинный', images: [{ url: 'https://cover' }], tracks: { total: 150 } });
      if (url.includes('/tracks?limit=100') && !saw429) { saw429 = true; return json(429, {}, { 'retry-after': '0' }); }
      if (url.includes('/tracks?limit=100')) return json(200, { items: [...Array.from({ length: 98 }, (_, i) => ({ track: t(i) })), { track: { is_local: true, name: 'local' } }, { track: t(99, { is_playable: false }) }], next: 'https://api.spotify.com/v1/playlists/x/tracks?offset=100' });
      if (url.includes('offset=100')) return json(200, { items: Array.from({ length: 50 }, (_, i) => ({ track: t(100 + i) })), next: null });
      return json(500, {});
    };
    const r = await sp.resolveSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { fetchImpl, limit: 300 });
    assert(tokens === 2, 'token renewed after the 401: ' + tokens);
    assert(r.name === 'Длинный' && r.items.length === 148 && r.skipped === 2, `${r.items.length} / skipped ${r.skipped}`);
    assert(r.items[0].artist === 'A, B' && r.items[0].durationSec === 180 && r.items[0].thumbnail === 'https://img/0', JSON.stringify(r.items[0]));
    const cut = await sp.resolveSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { fetchImpl, limit: 100 });
    assert(cut.items.length === 100 && cut.cut > 0, 'cut to the limit');
    const bad = async () => json(400, {});
    sp.resetToken();
    // wrong keys: falls back to the public page instead of failing
    const fallback = async (url) => (url.includes('accounts') ? bad() : { ok: true, status: 200, headers: { get: () => null }, text: async () => embedPage({ name: 'Трек', artists: [{ name: 'X' }], duration: 120000 }) });
    const one = await sp.resolveSpotify('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', { fetchImpl: fallback });
    assert(one.items.length === 1 && one.items[0].title === 'Трек', JSON.stringify(one));
    delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET;
  });
  await test('a Spotify link becomes tracks known by name (found on YouTube when they play), with what was skipped', async () => {
    const player = require('../bot/modules/music/player');
    const lazy = player.lazyTrack({ title: 'Song', artist: 'Artist', durationSec: 185 }, 'u1');
    assert(lazy.lazy && lazy.query === 'Artist Song' && lazy.duration === '3:05' && lazy.title === 'Song — Artist', JSON.stringify(lazy));
  });

  // ---------------- playlists ----------------
  await test('create, the same name twice is refused, rename, list with counts', async () => {
    await pl.create('u1', 'Вечер');
    await throwsText(() => pl.create('u1', 'вечер'), /уже есть/);
    await pl.create('u2', 'Вечер'); // another person may
    await pl.rename('u1', 'ВЕЧЕР', 'Ночь');
    const list = await pl.listOf('u1');
    assert(list.length === 1 && list[0].name === 'Ночь' && list[0].count === 0, JSON.stringify(list));
  });
  await test('add, remove by number, move: the order is kept', async () => {
    await pl.addTracks('u1', 'Ночь', [tr(1), tr(2), tr(3), tr(4)]);
    await pl.moveTrack('u1', 'Ночь', 4, 1);
    await pl.removeTrack('u1', 'Ночь', 3);
    const p = await pl.own('u1', 'Ночь');
    const rows = await pl.tracksOf(p.id);
    assert(rows.map((r) => r.title).join() === 'Song 4,Song 1,Song 3', rows.map((r) => r.title).join());
    assert(rows.map((r) => r.position).join() === '0,1,2', 'positions renumbered');
    await throwsText(() => pl.removeTrack('u1', 'Ночь', 9), /нет трека №9/);
  });
  await test('someone else cannot change or delete my playlist', async () => {
    await throwsText(() => pl.addTracks('u2', 'Ночь', [tr(9)]), /нет плейлиста/);
    await throwsText(() => pl.remove('u2', 'Ночь'), /нет плейлиста/);
  });
  await test('share by code: others play and copy it; closing the code stops that', async () => {
    const code = await pl.share('u1', 'Ночь');
    assert(/^[A-Z0-9]{8}$/.test(code), code);
    const { tracks, playlist } = await pl.forPlaying('u3', code);
    assert(tracks.length === 3 && playlist.name === 'Ночь' && tracks[0].requestedBy === 'u3', 'plays for another person');
    const copy = await pl.copyShared('u3', code, 'Копия');
    assert(copy.count === 3 && (await pl.listOf('u3'))[0].name === 'Копия', 'copied');
    await pl.share('u1', 'Ночь', false);
    await throwsText(() => pl.forPlaying('u3', code), /нет плейлиста/);
  });
  await test('shuffle play keeps every track; name-only tracks stay "lazy"; an empty playlist is refused', async () => {
    await pl.create('u4', 'Микс');
    await pl.addTracks('u4', 'Микс', [tr(1), tr(2), { title: 'Song — Artist', lazy: true, query: 'Artist Song', durationSec: 185, url: 'https://open.spotify.com/track/x' }]);
    const { tracks } = await pl.forPlaying('u4', 'Микс', { shuffle: true });
    assert(tracks.length === 3 && tracks.filter((t) => t.lazy).length === 1 && tracks.find((t) => t.lazy).query === 'Artist Song', JSON.stringify(tracks));
    await pl.create('u4', 'Пустой');
    await throwsText(() => pl.forPlaying('u4', 'Пустой'), /пуст/);
  });
  await test('limits: 25 playlists per person, 500 tracks per playlist', async () => {
    for (let i = 0; i < 25; i++) await pl.create('u5', 'P' + i);
    await throwsText(() => pl.create('u5', 'лишний'), /не больше 25/);
    const r = await pl.addTracks('u5', 'P0', Array.from({ length: 510 }, (_, i) => tr(i)));
    assert(r.added === 500 && r.cut === 10, JSON.stringify({ added: r.added, cut: r.cut }));
    await throwsText(() => pl.addTracks('u5', 'P0', [tr(1)]), /предел/);
  });
  await test('delete removes the tracks too', async () => {
    const p = await pl.own('u4', 'Микс');
    await pl.remove('u4', 'Микс');
    assert(!(await db.PlaylistTrack.count({ where: { playlistId: p.id } })), 'tracks gone');
  });
  await test('/playlist: create, list, show answer only to the person', async () => {
    const { makeInteraction, makeUser } = require('./mock');
    const cmd = require('../bot/commands/music/playlist');
    const run = async (sub, options = {}) => { const i = makeInteraction({ subcommand: sub, options, user: makeUser('u9') }); await cmd.execute(i); return JSON.stringify(i._replies); };
    assert((await run('create', { name: 'Утро' })).includes('создан'), 'create');
    assert((await run('list')).includes('Утро'), 'list');
    assert((await run('show', { name: 'Утро' })).includes('Пусто'), 'show');
    assert((await run('delete', { name: 'Нет такого' })).includes('нет плейлиста'), 'unknown name');
  });

  await test('panel: my playlists — create, add by search, move, remove, rename, share, delete; someone else\'s gives 404', async () => {
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use(express.urlencoded({ extended: true }));
    let who = 'w1';
    app.use((req, res, next) => { req.user = { id: who, username: who }; next(); });
    require('../web/modules'); // the menu reads the modules
    app.use('/dashboard', require('../web/routes/dashboard/music'));
    app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/dashboard/777000000000000001`;
    const post = (p, b) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    try {
      let r = await fetch(base + '/music'); const t0 = await r.text(); assert(r.status === 200 && t0.includes('Мои плейлисты'), 'page ' + r.status + t0.slice(0, 1600).replace(/\n/g, ' '));
      r = await post('/music/playlists', { name: 'Панель' });
      const loc = r.headers.get('location'); const id = /playlist\/(\d+)/.exec(loc)?.[1];
      assert(id, loc);
      for (const q of ['Song A', 'Song B', 'Song C']) { r = await post(`/music/playlist/${id}/add`, { query: q }); assert(!r.headers.get('location').includes('fail'), r.headers.get('location')); }
      let rows = await pl.tracksOf(Number(id));
      assert(rows.length === 3, 'added ' + rows.length);
      await post(`/music/playlist/${id}/move`, { from: '3', to: '1' });
      await post(`/music/playlist/${id}/remove`, { number: '2' });
      await post(`/music/playlist/${id}/rename`, { name: 'Новое имя' });
      await post(`/music/playlist/${id}/share`, { on: '1' });
      const p = await db.Playlist.findByPk(Number(id));
      assert(p.name === 'Новое имя' && /^[A-Z0-9]{8}$/.test(p.shareCode), JSON.stringify(p));
      const page = await (await fetch(base + `/music/playlist/${id}`)).text();
      assert(page.includes('Новое имя') && page.includes(p.shareCode) && page.includes('Убрать'), 'playlist page');
      who = 'w2';
      assert((await fetch(base + `/music/playlist/${id}`)).status === 404, 'another person sees nothing');
      r = await post(`/music/playlist/${id}/delete`, {});
      assert(r.headers.get('location').includes('fail') && await db.Playlist.findByPk(Number(id)), 'another person cannot delete');
      who = 'w1';
      await post(`/music/playlist/${id}/delete`, {});
      assert(!(await db.Playlist.findByPk(Number(id))), 'deleted by the owner');
      r = await post('/music/control', { action: 'skip' });
      assert(r.headers.get('location').includes('notplaying'), 'nothing plays');
    } finally { server.close(); }
  });

  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : `\n   ${r.e}`}`);
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
