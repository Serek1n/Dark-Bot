// Spotify links → track names, artists, covers and lengths. Spotify does not let bots stream its audio (DRM, and the Web API
// gives no audio), so each track is then looked up on YouTube by "artist — title" and the closest length wins
// (player.js). Nothing here claims to play Spotify itself.
//
// Two ways to read a link:
//  1. the official Web API with SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (Client Credentials): albums and playlists of any
//     length, paged by 50/100; the token is cached and renewed before it runs out or after a 401; a 429 waits for Retry-After.
//  2. without keys — the public embed page (open.spotify.com/embed/...), the same data a website preview shows: enough for a
//     track, an album and the first 100 tracks of a playlist.
const logger = require('../../utils/logger');

const API = 'https://api.spotify.com/v1';
const LINK = /^(?:https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?|spotify:)(track|album|playlist|artist)[/:]([A-Za-z0-9]{22})/i;

/** { type, id } of a Spotify link or URI, or null. */
function parseSpotifyUrl(text) {
  const m = LINK.exec(String(text || '').trim());
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}
const isSpotifyUrl = (q) => Boolean(parseSpotifyUrl(q)) || /^https?:\/\/spotify\.link\//i.test(String(q || '').trim());

class SpotifyError extends Error {
  constructor(text, code) { super(text); this.code = code; this.userText = text; }
}

const hasKeys = () => Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
let token = null; // { value, until }

async function getToken(fetchImpl, force = false) {
  if (!force && token && token.until > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetchImpl('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10_000)
  });
  if (res.status === 400 || res.status === 401) throw new SpotifyError('Ключи Spotify неверные (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET). Проверьте их в файле .env.', 'auth');
  if (!res.ok) throw new SpotifyError(`Spotify не выдал доступ (код ${res.status}). Попробуйте позже.`, 'auth');
  const j = await res.json();
  token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET from the Web API: renews the token once after a 401, waits on a 429 (at most twice, 10 s each). */
async function api(path, fetchImpl = fetch) {
  let renewed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchImpl(path.startsWith('http') ? path : API + path, { headers: { authorization: `Bearer ${await getToken(fetchImpl, renewed && attempt === 1)}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 && !renewed) { renewed = true; token = null; continue; }
    if (res.status === 429) {
      const wait = Math.min(10, Number(res.headers?.get?.('retry-after')) || 2) * 1000;
      logger.warn?.(`Spotify rate limit, waiting ${wait} ms`);
      if (attempt >= 2) throw new SpotifyError('Spotify временно ограничил запросы. Повторите через минуту.', 'rate');
      await sleep(wait); continue;
    }
    if (res.status === 404) throw new SpotifyError('Spotify: не найдено. Ссылка неверная, плейлист закрытый или это редакционный плейлист Spotify — такие API не отдаёт.', 'notfound');
    if (res.status === 403) throw new SpotifyError('Spotify не разрешает читать эту ссылку через API.', 'forbidden');
    if (!res.ok) throw new SpotifyError(`Spotify ответил ошибкой ${res.status}.`, 'http');
    return res.json();
  }
  throw new SpotifyError('Spotify не ответил. Попробуйте позже.', 'http');
}

/** One Spotify track (API object) → our item; null for a local file or a track that can't be played anywhere. */
function itemFromApi(t, cover) {
  if (!t || t.is_local || t.type === 'episode') return null;
  return {
    title: t.name, artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    durationSec: Math.round((Number(t.duration_ms) || 0) / 1000), thumbnail: t.album?.images?.[0]?.url || cover || null,
    spotifyUrl: t.external_urls?.spotify || (t.id ? `https://open.spotify.com/track/${t.id}` : null), unavailable: t.is_playable === false
  };
}

async function viaApi({ type, id }, limit, fetchImpl) {
  if (type === 'track') {
    const t = await api(`/tracks/${id}`, fetchImpl);
    return { name: t.name, type, items: [itemFromApi(t)].filter(Boolean) };
  }
  if (type === 'album') {
    const a = await api(`/albums/${id}`, fetchImpl);
    const cover = a.images?.[0]?.url;
    const items = (a.tracks?.items || []).map((t) => itemFromApi(t, cover));
    let next = a.tracks?.next;
    while (next && items.filter((x) => x && !x.unavailable).length < limit) { const p = await api(next, fetchImpl); items.push(...(p.items || []).map((t) => itemFromApi(t, cover))); next = p.next; }
    return { name: a.name, type, cover, ...split(items, limit) };
  }
  if (type === 'playlist') {
    const p = await api(`/playlists/${id}?fields=name,images,tracks.total`, fetchImpl);
    const items = [];
    let next = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,name,type,is_local,is_playable,duration_ms,external_urls,artists(name),album(images)))`;
    const usable = () => items.filter((x) => x && !x.unavailable).length;
    while (next && usable() < limit) { const page = await api(next, fetchImpl); items.push(...(page.items || []).map((x) => itemFromApi(x.track))); next = page.next; }
    const r = split(items, limit);
    // pages that were not read count as "did not fit" too
    if (next) r.cut += Math.max(0, (Number(p.tracks?.total) || 0) - items.length);
    return { name: p.name, type, cover: p.images?.[0]?.url, total: p.tracks?.total, ...r };
  }
  if (type === 'artist') {
    const a = await api(`/artists/${id}`, fetchImpl);
    const top = await api(`/artists/${id}/top-tracks?market=US`, fetchImpl);
    return { name: a.name, type, ...split((top.tracks || []).map((t) => itemFromApi(t)), limit) };
  }
  throw new SpotifyError('Такие ссылки Spotify не поддерживаются.', 'type');
}

/** Drops local files and unplayable tracks, counting them, and cuts to the limit. */
function split(items, limit) {
  const ok = items.filter((x) => x && !x.unavailable);
  return { items: ok.slice(0, limit), skipped: items.length - ok.length, cut: Math.max(0, ok.length - limit) };
}

/** The data of the public embed page (what a link preview shows): { name, items } or throws. */
function parseEmbedHtml(html, type) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) throw new SpotifyError('Spotify не отдал данные этой ссылки. Попробуйте позже или добавьте ключи Spotify в .env.', 'embed');
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new SpotifyError('Spotify отдал непонятные данные.', 'embed'); }
  const e = data?.props?.pageProps?.state?.data?.entity;
  if (!e) throw new SpotifyError('Spotify: не найдено — ссылка неверная или закрытая.', 'notfound');
  const cover = e.coverArt?.sources?.[0]?.url || e.visualIdentity?.image?.[0]?.url || null;
  const secs = (ms) => Math.round((Number(ms) || 0) / 1000);
  if (type === 'track') {
    return { name: e.name || e.title, type, items: [{ title: e.name || e.title, artist: (e.artists || []).map((a) => a.name).join(', '), durationSec: secs(e.duration), thumbnail: cover, unavailable: e.isPlayable === false }].filter((x) => x.title) };
  }
  const list = (e.trackList || []).map((t) => ({ title: t.title, artist: t.subtitle || '', durationSec: secs(t.duration), thumbnail: cover, unavailable: t.isPlayable === false }));
  return { name: e.name || e.title, type, cover, items: list.filter((x) => x.title) };
}

async function viaEmbed({ type, id }, limit, fetchImpl) {
  const res = await fetchImpl(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DarkBot)', 'accept-language': 'en' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new SpotifyError('Spotify: не найдено — ссылка неверная или закрытая.', 'notfound');
  if (res.status === 429) throw new SpotifyError('Spotify временно ограничил запросы. Повторите через минуту.', 'rate');
  if (!res.ok) throw new SpotifyError(`Spotify ответил ошибкой ${res.status}.`, 'http');
  const r = parseEmbedHtml(await res.text(), type);
  return { ...r, ...split(r.items, limit) };
}

/** A short link (spotify.link/…) → the open.spotify.com link it leads to. */
async function expandShort(url, fetchImpl) {
  const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const to = res.headers?.get?.('location');
  if (to && parseSpotifyUrl(to)) return to;
  const html = res.status === 200 ? await res.text() : '';
  const m = /https:\/\/open\.spotify\.com\/[a-z]+\/[A-Za-z0-9]{22}/.exec(html);
  if (m) return m[0];
  throw new SpotifyError('Не получилось открыть короткую ссылку Spotify. Пришлите полную ссылку open.spotify.com.', 'link');
}

/**
 * Reads a Spotify link: { name, type, cover?, items: [{ title, artist, durationSec, thumbnail }], skipped, cut }.
 * Throws SpotifyError with a text for the member.
 */
async function resolveSpotify(url, { limit = 100, fetchImpl = fetch } = {}) {
  if (/^https?:\/\/spotify\.link\//i.test(String(url).trim())) url = await expandShort(String(url).trim(), fetchImpl);
  const ref = parseSpotifyUrl(url);
  if (!ref) throw new SpotifyError('Это не ссылка на трек, альбом или плейлист Spotify.', 'link');
  if (hasKeys()) {
    try { return await viaApi(ref, limit, fetchImpl); } catch (err) {
      if (err.code === 'auth') logger.warn?.(`Spotify API: ${err.message} — reading the public page instead`);
      else throw err;
    }
  }
  if (ref.type === 'artist') throw new SpotifyError('Ссылки на исполнителей Spotify работают только с ключами Spotify в .env.', 'type');
  return viaEmbed(ref, limit, fetchImpl);
}

const resetToken = () => { token = null; };

module.exports = { parseSpotifyUrl, isSpotifyUrl, resolveSpotify, parseEmbedHtml, itemFromApi, SpotifyError, resetToken, hasKeys };
