const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Fonts are bundled in the repo (not relying on whatever happens to be installed on the host) so cards
// render identically on any VPS. Manrope draws everything — text and figures; it covers Latin, Cyrillic
// (with the extended letters), Greek and Vietnamese. DejaVu Sans stays as the fallback for whatever
// Manrope has no glyph for (symbols, rarer scripts in nicknames), so those don't turn into boxes.
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Manrope-Regular.ttf'), 'CardSans');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Manrope-ExtraBold.ttf'), 'CardSansBold');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Manrope-ExtraBold.ttf'), 'CardMonoBold'); // figures
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'DejaVuSans.ttf'), 'CardFallback');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'), 'CardFallbackBold');
  fontsRegistered = true;
}

const COLORS = {
  bg: '#14161b',
  panel: '#1a1c22',
  raised: '#1f2229',
  hairline: '#2a2d35',
  paper: '#ece8e0',
  fog: '#9498a0',
  ember: '#e3a857',
  emberDeep: '#c98a3f',
  emberLight: '#f0c078',
  track: '#232630',
  silver: '#b9bcc4',
  bronze: '#c08a5b'
};

const SCALE = 2; // render at 2x so the card stays sharp on HiDPI screens

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateToWidth(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (ctx.measureText(str).width <= maxWidth) return str;
  let result = str;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

// 12345 -> "12 345" (thin, language-neutral grouping)
function fmt(n) {
  return Math.trunc(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Avatars are downloaded for every /profile and /top. Keep decoded images for a few minutes (and share
// a download that is already in flight); a slow or dead CDN gives up after 4 s instead of hanging the
// command, and a failure is remembered briefly so the same broken link is not retried at once.
const AVATAR_TTL_MS = 10 * 60 * 1000;
const AVATAR_FAIL_TTL_MS = 30 * 1000;
const avatarCache = new Map(); // url -> { promise, expires }
function loadAvatar(url) {
  const hit = avatarCache.get(url);
  if (hit && hit.expires > Date.now()) return hit.promise;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('avatar timeout')), 4000); });
  const entry = { expires: Date.now() + AVATAR_TTL_MS };
  entry.promise = Promise.race([loadImage(url), timeout])
    .finally(() => clearTimeout(timer))
    .catch((err) => { entry.expires = Date.now() + AVATAR_FAIL_TTL_MS; throw err; });
  if (avatarCache.size >= 300) avatarCache.delete(avatarCache.keys().next().value);
  avatarCache.set(url, entry);
  return entry.promise;
}

function makeCanvas(w, h) {
  const canvas = createCanvas(w * SCALE, h * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  return { canvas, ctx };
}

/** The card itself: a flat dark rounded surface with a 1px inner edge so it reads on Discord's dark theme. */
function paintCard(ctx, W, H) {
  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, W, H, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 24);
  ctx.stroke();
}

/** A tile on the card: the panel colour with a hairline edge (or a coloured one). */
function paintTile(ctx, x, y, w, h, r = 16, edge = COLORS.hairline) {
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
}

/** A progress line with a soft glow at its head. */
function paintBar(ctx, x, y, w, h, ratio, from = COLORS.emberDeep, to = COLORS.emberLight, glow = true) {
  ctx.fillStyle = COLORS.track;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (!(ratio > 0)) return;
  const fw = Math.max(h, w * Math.min(1, ratio));
  const g = ctx.createLinearGradient(x, 0, x + fw, 0);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, fw, h, h / 2);
  ctx.fill();
  if (!glow) return;
  ctx.save();
  ctx.shadowColor = 'rgba(240,192,120,0.8)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = to;
  ctx.beginPath();
  ctx.arc(x + fw - h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A big figure in a column of fixed width: the full number, made smaller when it is long, and shortened
// ("12,3 млн") only when even the smallest size does not fit. Sets ctx.font and returns the text to draw.
function shortNumber(n) {
  const v = Math.trunc(Number(n) || 0);
  const part = (base) => {
    const x = v / base;
    return (x >= 100 ? Math.trunc(x) : Math.trunc(x * 10) / 10).toString().replace('.', ',');
  };
  if (Math.abs(v) >= 1e9) return `${part(1e9)} млрд`;
  if (Math.abs(v) >= 1e6) return `${part(1e6)} млн`;
  if (Math.abs(v) >= 1e3) return `${part(1e3)} тыс`;
  return String(v);
}
function fitNumber(ctx, n, maxWidth, size, minSize) {
  const full = fmt(n);
  for (let px = size; px >= minSize; px -= 2) {
    ctx.font = `${px}px CardMonoBold, CardFallbackBold`;
    if (ctx.measureText(full).width <= maxWidth) return full;
  }
  const short = shortNumber(n);
  for (let px = size; px >= minSize; px -= 2) {
    ctx.font = `${px}px CardMonoBold, CardFallbackBold`;
    if (ctx.measureText(short).width <= maxWidth) return short;
  }
  return truncateToWidth(ctx, short, maxWidth);
}

// Voice time as a figure and a caption: whole hours once there is at least one, minutes before that.
function voiceStat(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  return h ? [h, 'ч в голосе'] : [Math.floor(s / 60), 'мин в голосе'];
}

/** Rounded-square avatar in an ember frame; a letter badge when the picture can't be loaded. */
async function drawSquareAvatar(ctx, url, name, x, y, size, radius, frame = COLORS.ember, fw = 4) {
  if (frame) {
    ctx.fillStyle = frame;
    roundRect(ctx, x - fw, y - fw, size + fw * 2, size + fw * 2, radius + fw);
    ctx.fill();
  }
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  try {
    if (!url) throw new Error('no avatar');
    const img = await loadAvatar(url);
    ctx.drawImage(img, x, y, size, size);
  } catch {
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, '#2b2e37');
    grad.addColorStop(1, '#1b1d23');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.ember;
    ctx.font = `${Math.round(size * 0.48)}px CardSansBold, CardFallbackBold`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((String(name || '?').trim()[0] || '?').toUpperCase(), x + size / 2, y + size / 2 + size * 0.02);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/**
 * The profile card as a PNG buffer: a framed square avatar with the name, level, place and XP bar beside it, and the
 * numbers below in three groups — economy, activity, experience — two figures each.
 * @param {{ username: string, avatarURL?: string, level: number, xpIntoLevel: number, xpNeeded: number,
 *   balance: number, currencyName: string, crystals?: number, crystalName?: string, messageCount: number,
 *   voiceSeconds?: number, chatXp?: number, voiceXp?: number, rank?: number, totalMembers?: number, badge?: string }} data
 * @returns {Promise<Buffer>}
 */
async function drawRankCard(data) {
  ensureFonts();
  const W = 900;
  const H = 376;
  const { canvas, ctx } = makeCanvas(W, H);

  paintCard(ctx, W, H);

  await drawSquareAvatar(ctx, data.avatarURL, data.username, 40, 32, 132, 26);

  const left = 200;
  const right = W - 36;
  ctx.textBaseline = 'alphabetic';

  // XP numbers on the right first, so the line beside them knows how much room it has
  const xpText = `${fmt(data.xpIntoLevel)} / ${fmt(data.xpNeeded)} XP`;
  ctx.font = '16px CardMonoBold, CardFallbackBold';
  const xpW = ctx.measureText(xpText).width;
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.emberLight;
  ctx.fillText(xpText, right, 120);
  ctx.textAlign = 'left';

  // a season badge ("Сезон 3 · #1") as a small pill at the top right; the name leaves room for it
  let badgeW = 0;
  if (data.badge) {
    ctx.font = '13px CardSansBold, CardFallbackBold';
    badgeW = ctx.measureText(data.badge).width + 24;
    ctx.strokeStyle = COLORS.ember; ctx.lineWidth = 1.5;
    roundRect(ctx, right - badgeW, 40, badgeW, 26, 13); ctx.stroke();
    ctx.fillStyle = COLORS.emberLight; ctx.textAlign = 'right';
    ctx.fillText(data.badge, right - 12, 58); ctx.textAlign = 'left';
  }
  ctx.fillStyle = COLORS.paper;
  ctx.font = '36px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, data.username, right - left - (badgeW ? badgeW + 16 : 0)), left, 88);

  let place = '';
  if (data.rank && data.totalMembers) place = `  ·  #${fmt(data.rank)} из ${fmt(data.totalMembers)}`;
  else if (data.rank) place = `  ·  #${fmt(data.rank)}`;
  ctx.fillStyle = 'rgba(236,232,224,0.75)';
  ctx.font = '17px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, `${fmt(data.level)} уровень${place}`, right - left - xpW - 24), left, 120);

  // XP bar with a soft glow at its head
  const ratio = data.xpNeeded > 0 ? Math.max(0, Math.min(1, data.xpIntoLevel / data.xpNeeded)) : 0;
  paintBar(ctx, left, 142, right - left, 10, ratio);

  // Three groups of two numbers
  const groups = [
    ['ЭКОНОМИКА', [[data.balance, data.currencyName || 'монеты'], [data.crystals || 0, data.crystalName || 'кристаллы']]],
    ['АКТИВНОСТЬ', [[data.messageCount, 'сообщений'], voiceStat(data.voiceSeconds)]],
    ['ОПЫТ', [[data.chatXp ?? 0, 'XP за чат'], [data.voiceXp ?? 0, 'XP за голос']]]
  ];
  const gap = 12;
  const gx0 = 36;
  const gy = 198;
  const gh = 142;
  const gw = (W - gx0 * 2 - gap * 2) / 3;
  groups.forEach(([title, items], i) => {
    const gx = gx0 + i * (gw + gap);
    paintTile(ctx, gx, gy, gw, gh);

    ctx.fillStyle = COLORS.ember;
    roundRect(ctx, gx + 20, gy + 22, 4, 14, 2);
    ctx.fill();
    ctx.fillStyle = COLORS.fog;
    ctx.font = '12px CardSansBold, CardFallbackBold';
    ctx.fillText(title, gx + 32, gy + 34);

    const colW = (gw - 40) / 2;
    items.forEach(([value, label], j) => {
      const sx = gx + 20 + j * colW;
      ctx.fillStyle = COLORS.paper;
      ctx.fillText(fitNumber(ctx, value, colW - 18, 30, 16), sx, gy + 92);
      ctx.fillStyle = COLORS.fog;
      ctx.font = '13px CardSans, CardFallback';
      ctx.fillText(truncateToWidth(ctx, label, colW - 10), sx, gy + 118);
    });
  });

  return canvas.encode('png');
}

/**
 * Renders the server leaderboard as a PNG buffer.
 * @param {{ title: string, rows: Array<{ rank: number, name: string, avatarURL?: string, level: number, xp: number }> }} data
 */
// The same card is asked for again and again (people look at their own profile, others look at it too). The finished picture is kept for a minute,
// keyed by everything that is drawn on it; the voice time is counted in whole minutes so it does not make every request different.
const CARD_TTL_MS = 60_000;
const CARD_MAX = 100;
const cardCache = new Map(); // key -> { promise, expires }

function renderRankCard(data) {
  const key = JSON.stringify({ ...data, voiceSeconds: Math.floor((Number(data.voiceSeconds) || 0) / 60) });
  const hit = cardCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = drawRankCard(data);
  cardCache.set(key, { promise, expires: Date.now() + CARD_TTL_MS });
  promise.catch(() => cardCache.delete(key)); // a failed drawing is not remembered
  if (cardCache.size > CARD_MAX) for (const [k, v] of cardCache) if (v.expires < Date.now() || cardCache.size > CARD_MAX) cardCache.delete(k);
  return promise;
}

// The leaderboard in the profile card's style: a heading with an ember mark, then one tile per member —
// place, framed square avatar, name with a progress line, and the level (or voice time) on the right.
async function renderLeaderboard(data) {
  ensureFonts();
  const rows = data.rows.slice(0, 10);
  const W = 900;
  const HEADER = 112;
  const ROW = 72;
  const TILE = 62;
  const PAD_BOTTOM = 26;
  const H = HEADER + rows.length * ROW - (ROW - TILE) + PAD_BOTTOM;
  const { canvas, ctx } = makeCanvas(W, H);
  paintCard(ctx, W, H);

  const left = 36;
  const right = W - 36;
  ctx.textBaseline = 'alphabetic';

  // Page counter first, so the title beside it knows how much room it has
  let pillW = 0;
  if (data.pages > 1) {
    const text = `стр. ${data.page} / ${data.pages}`;
    ctx.font = '15px CardSansBold, CardFallbackBold';
    pillW = ctx.measureText(text).width + 28;
    ctx.fillStyle = COLORS.raised;
    roundRect(ctx, right - pillW, 38, pillW, 32, 16);
    ctx.fill();
    ctx.fillStyle = COLORS.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, right - pillW / 2, 54.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  const titleW = right - left - 20 - pillW - 20;
  ctx.fillStyle = COLORS.ember;
  roundRect(ctx, left, 36, 5, 50, 2.5);
  ctx.fill();
  ctx.fillStyle = COLORS.paper;
  ctx.font = '30px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, data.heading || 'Таблица лидеров', titleW), left + 20, 62);
  ctx.fillStyle = COLORS.fog;
  ctx.font = '15px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, data.title || '', titleW), left + 20, 85);

  const medal = [COLORS.ember, COLORS.silver, COLORS.bronze];
  const maxXp = Math.max(1, Number(data.maxXp) || 0, ...rows.map((r) => Number(r.xp) || 0));
  // all avatars are fetched at once; drawing below then takes them from the cache
  await Promise.all(rows.map((r) => (r.avatarURL ? loadAvatar(r.avatarURL).catch(() => null) : null)));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const y = HEADER + i * ROW;
    const mid = y + TILE / 2;
    const place = r.rank <= 3 ? medal[r.rank - 1] : null;
    paintTile(ctx, left, y, right - left, TILE, 16, r.rank === 1 ? 'rgba(227,168,87,0.45)' : COLORS.hairline);

    // Place: a filled badge for the first three, a plain number after them
    const bx = left + 16;
    if (place) {
      ctx.fillStyle = place;
      roundRect(ctx, bx, mid - 16, 32, 32, 10);
      ctx.fill();
    }
    ctx.fillStyle = place ? COLORS.bg : COLORS.fog;
    ctx.font = `${r.rank >= 100 ? 13 : 16}px CardSansBold, CardFallbackBold`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(r.rank), bx + 16, mid + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Avatar: a square, framed in the medal colour for the first three
    const ax = left + 66;
    const as = 40;
    await drawSquareAvatar(ctx, r.avatarURL, r.name, ax, mid - as / 2, as, 11, place, 3);

    // Level (or voice time) and XP on the right; measured first so the name and the line stop before them
    const big = r.sub || `ур. ${r.level}`;
    const small = r.small || `${fmt(r.xp)} XP`;
    ctx.font = '22px CardSansBold, CardFallbackBold';
    const bigW = ctx.measureText(big).width;
    ctx.font = '13px CardSans, CardFallback';
    const smallW = ctx.measureText(small).width;
    const sideW = Math.max(110, bigW, smallW);
    ctx.textAlign = 'right';
    ctx.fillStyle = place || COLORS.paper;
    ctx.font = '22px CardSansBold, CardFallbackBold';
    ctx.fillText(big, right - 20, mid + 2);
    ctx.fillStyle = COLORS.fog;
    ctx.font = '13px CardSans, CardFallback';
    ctx.fillText(small, right - 20, mid + 20);
    ctx.textAlign = 'left';

    // Name and progress line
    const nx = ax + as + 20;
    const nw = right - 20 - sideW - 28 - nx;
    ctx.fillStyle = COLORS.paper;
    ctx.font = '19px CardSansBold, CardFallbackBold';
    ctx.fillText(truncateToWidth(ctx, r.name, nw), nx, mid - 3);
    const from = place || COLORS.emberDeep;
    const to = r.rank === 1 ? COLORS.emberLight : place || COLORS.ember;
    paintBar(ctx, nx, mid + 9, nw, 6, (Number(r.xp) || 0) / maxXp, from, to, r.rank === 1);
  }

  return canvas.encode('png');
}

module.exports = { renderRankCard, renderLeaderboard, cardKit: { ensureFonts, makeCanvas, paintCard, paintTile, drawSquareAvatar, truncateToWidth, COLORS } };
