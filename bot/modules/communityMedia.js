// Pictures of the catalog «Сообщества» (screenshots and the banner) are kept by the bot itself, in data/media/communities.
// Discord's attachment links stop working about a day after they are copied (signed links with ?ex=…), so a link from
// Discord or Imgur is downloaded once when the card is saved, and a file can be uploaded straight from the panel.
// Every picture is decoded and drawn anew as WebP (at most 1920 px wide): what is stored is a clean picture, nothing else
// that came with the file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', '..', 'data', 'media', 'communities'));
const MAX_BYTES = 8 * 1024 * 1024; // what is accepted before re-drawing
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920;
const REMOTE_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'i.imgur.com'];
const LOCAL = /^\/communities\/media\/(\d{15,25})\/([a-f0-9]{20})\.webp$/;

class MediaError extends Error {}

const isLocal = (u) => LOCAL.test(String(u || ''));
const fileOf = (u) => { const m = LOCAL.exec(String(u || '')); return m ? path.join(DIR, m[1], `${m[2]}.webp`) : null; };

/** The first bytes say what the file really is (the name and the type the browser sent are not trusted). */
function kindOf(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  return null;
}

/** Stores a picture for the server and returns its address on this site. */
async function store(guildId, buf) {
  if (!/^\d{15,25}$/.test(String(guildId))) throw new MediaError('Неизвестный сервер.');
  if (!Buffer.isBuffer(buf) || !buf.length) throw new MediaError('Пустой файл.');
  if (buf.length > MAX_BYTES) throw new MediaError('Картинка больше 8 МБ — уменьшите её.');
  if (!kindOf(buf)) throw new MediaError('Это не картинка: подойдут PNG, JPEG, WebP или GIF.');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  let img;
  try { img = await loadImage(buf); } catch { throw new MediaError('Картинку не удалось прочитать — возможно, файл повреждён.'); }
  if (!img.width || !img.height || img.width * img.height > 40_000_000) throw new MediaError('Слишком большая картинка по размеру.');
  const k = Math.min(1, MAX_WIDTH / img.width, MAX_HEIGHT / img.height);
  const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = await canvas.encode('webp', 86);
  const name = crypto.createHash('sha256').update(out).digest('hex').slice(0, 20);
  const dir = path.join(DIR, String(guildId));
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.webp`);
  if (!fs.existsSync(file)) await fs.promises.writeFile(file, out);
  return `/communities/media/${guildId}/${name}.webp`;
}

/** Downloads a picture by its link (Discord or Imgur only) and stores it. */
async function importUrl(guildId, url) {
  let u; try { u = new URL(String(url)); } catch { throw new MediaError('Ссылка на картинку некорректна.'); }
  if (u.protocol !== 'https:' || !REMOTE_HOSTS.includes(u.hostname)) throw new MediaError(`Картинки по ссылке — только с ${REMOTE_HOSTS.join(', ')}. Или загрузите файл.`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(u.href, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'DarkBot (catalog pictures)' } });
  } catch {
    throw new MediaError('Не удалось скачать картинку по ссылке. Загрузите её файлом.');
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new MediaError(res.status === 404 || res.status === 403 ? 'Ссылка на картинку устарела (Discord выдаёт такие ссылки на сутки). Загрузите картинку файлом.' : `Картинка по ссылке недоступна (${res.status}). Загрузите её файлом.`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new MediaError('Картинка больше 8 МБ — уменьшите её.');
  const buf = Buffer.from(await res.arrayBuffer());
  return store(guildId, buf);
}

/** A picture of a card: our own one stays (if the file is there), a link from Discord or Imgur is downloaded and kept. */
async function keep(guildId, ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  if (isLocal(s)) {
    if (!s.startsWith(`/communities/media/${guildId}/`)) throw new MediaError('Картинка принадлежит другому серверу.');
    if (!fs.existsSync(fileOf(s))) throw new MediaError('Загруженная картинка не найдена — загрузите её ещё раз.');
    return s;
  }
  return api.importUrl(guildId, s); // through the exports: the tests replace the download
}

/**
 * Deletes the server's pictures its card no longer uses: at once those it used before (`was`), the others when they are
 * older than six hours (a picture uploaded a moment ago may belong to a card that is being filled in). An empty `used`
 * with no `was` (the card removed) deletes all of them.
 */
async function prune(guildId, used = [], was = null) {
  const dir = path.join(DIR, String(guildId));
  if (!/^\d{15,25}$/.test(String(guildId)) || !fs.existsSync(dir)) return 0;
  const keepNames = new Set(used.filter(isLocal).map((u) => path.basename(fileOf(u))));
  const dropNow = new Set((was || []).filter(isLocal).map((u) => path.basename(fileOf(u))));
  const all = !used.length && !was;
  let n = 0;
  for (const f of await fs.promises.readdir(dir)) {
    if (keepNames.has(f)) continue;
    if (!all && !dropNow.has(f)) {
      const st = await fs.promises.stat(path.join(dir, f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs < 6 * 3600 * 1000) continue;
    }
    await fs.promises.unlink(path.join(dir, f)).catch(() => {});
    n++;
  }
  return n;
}

const api = module.exports = { DIR, LOCAL, REMOTE_HOSTS, MAX_BYTES, MediaError, isLocal, fileOf, kindOf, store, importUrl, keep, prune };
