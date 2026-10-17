// Apple Music links: the site gives no audio, so read the track names from the public page
// (schema.org data) and let the player find the same songs on YouTube, like it does for Spotify.
const APPLE_RE = /^https?:\/\/(embed\.)?music\.apple\.com\//i;
const MAX_TRACKS = 50;

const isAppleMusicUrl = (q) => APPLE_RE.test(String(q).trim());

const unescapeHtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const artistOf = (x) => { const a = x?.byArtist; const first = Array.isArray(a) ? a[0] : a; return first?.name || (typeof first === 'string' ? first : '') || ''; };

/** Pulls { name, artist } pairs out of the page HTML. `trackId` (the ?i= part of a link) picks one song of an album. */
function parseAppleMusicHtml(html, trackId = null) {
  const found = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) {
      const type = [].concat(node?.['@type'] || []);
      if (type.includes('MusicRecording')) found.push({ name: node.name, artist: artistOf(node), url: node.url || '' });
      const list = node?.track || node?.tracks;
      if (Array.isArray(list)) {
        for (const t of list) found.push({ name: t.name, artist: artistOf(t) || artistOf(node), url: t.url || '' });
      }
    }
  }
  let tracks = found.filter((t) => t.name);
  if (trackId) {
    const one = tracks.filter((t) => String(t.url).includes(`i=${trackId}`));
    if (one.length) tracks = one;
  }
  if (!tracks.length) {
    const og = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html);
    if (og) {
      const title = unescapeHtml(og[1]).replace(/\s+on Apple Music.*$/i, '').replace(/\s+[-–—]\s+(Single|EP|Album)\b.*$/i, '').trim();
      if (title) tracks = [{ name: title.replace(/\s+by\s+/i, ' — '), artist: '' }];
    }
  }
  return tracks.slice(0, MAX_TRACKS).map((t) => ({ name: unescapeHtml(t.name), artist: unescapeHtml(t.artist) }));
}

async function resolveAppleMusic(url, fetchImpl = fetch) {
  let trackId = null;
  try { trackId = new URL(url).searchParams.get('i'); } catch { /* keep null */ }
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DarkBot)', 'accept-language': 'en' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Apple Music ответил ${res.status}`);
  const tracks = parseAppleMusicHtml(await res.text(), trackId);
  if (!tracks.length) throw new Error('Не удалось прочитать список треков по этой ссылке Apple Music.');
  return tracks;
}

module.exports = { isAppleMusicUrl, parseAppleMusicHtml, resolveAppleMusic };
