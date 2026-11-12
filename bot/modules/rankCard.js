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

/** Draws a circular avatar; falls back to a letter badge when the image can't be loaded. */
async function drawAvatar(ctx, url, name, cx, cy, radius) {
  try {
    if (!url) throw new Error('no avatar');
    const img = await loadAvatar(url);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  } catch {
    const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, '#2b2e37');
    grad.addColorStop(1, '#1b1d23');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    const letter = (String(name || '?').trim()[0] || '?').toUpperCase();
    ctx.fillStyle = COLORS.ember;
    ctx.font = `${Math.round(radius * 0.95)}px CardSansBold, CardFallbackBold`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, cx, cy + radius * 0.04);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/** Small crescent-moon mark (the Dark logo) used as a quiet watermark. */
function drawCrescent(ctx, cx, cy, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Clip to "everything outside the bite circle", then fill the full moon: leaves a crescent
  // without erasing anything already painted on the card.
  ctx.beginPath();
  ctx.rect(cx - r * 2, cy - r * 2, r * 4, r * 4);
  ctx.arc(cx + r * 0.42, cy - r * 0.2, r * 0.82, 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintBackground(ctx, W, H, glowX, glowY) {
  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, W, H, 22);
  ctx.fill();

  const glow = ctx.createRadialGradient(glowX, glowY, 10, glowX, glowY, 260);
  glow.addColorStop(0, 'rgba(227,168,87,0.17)');
  glow.addColorStop(1, 'rgba(227,168,87,0)');
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 22);
  ctx.clip();
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // 1px inner border so the card reads as a surface on Discord's dark theme
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 22);
  ctx.stroke();
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
async function drawSquareAvatar(ctx, url, name, x, y, size, radius) {
  ctx.fillStyle = COLORS.ember;
  roundRect(ctx, x - 4, y - 4, size + 8, size + 8, radius + 4);
  ctx.fill();
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
 *   voiceSeconds?: number, chatXp?: number, voiceXp?: number, rank?: number, totalMembers?: number }} data
 * @returns {Promise<Buffer>}
 */
async function drawRankCard(data) {
  ensureFonts();
  const W = 900;
  const H = 376;
  const { canvas, ctx } = makeCanvas(W, H);

  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, W, H, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 24);
  ctx.stroke();

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

  ctx.fillStyle = COLORS.paper;
  ctx.font = '36px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, data.username, right - left), left, 88);

  let place = '';
  if (data.rank && data.totalMembers) place = `  ·  #${fmt(data.rank)} из ${fmt(data.totalMembers)}`;
  else if (data.rank) place = `  ·  #${fmt(data.rank)}`;
  ctx.fillStyle = 'rgba(236,232,224,0.75)';
  ctx.font = '17px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, `${fmt(data.level)} уровень${place}`, right - left - xpW - 24), left, 120);

  // XP bar with a soft glow at its head
  const barY = 142;
  const barH = 10;
  const barW = right - left;
  ctx.fillStyle = COLORS.track;
  roundRect(ctx, left, barY, barW, barH, barH / 2);
  ctx.fill();
  const ratio = data.xpNeeded > 0 ? Math.max(0, Math.min(1, data.xpIntoLevel / data.xpNeeded)) : 0;
  if (ratio > 0) {
    const fw = Math.max(barH, barW * ratio);
    const fillGrad = ctx.createLinearGradient(left, 0, left + fw, 0);
    fillGrad.addColorStop(0, COLORS.emberDeep);
    fillGrad.addColorStop(1, COLORS.emberLight);
    ctx.fillStyle = fillGrad;
    roundRect(ctx, left, barY, fw, barH, barH / 2);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = 'rgba(240,192,120,0.8)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLORS.emberLight;
    ctx.beginPath();
    ctx.arc(left + fw - barH / 2, barY + barH / 2, barH / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, gx, gy, gw, gh, 16);
    ctx.fill();
    ctx.strokeStyle = COLORS.hairline;
    ctx.lineWidth = 1;
    roundRect(ctx, gx + 0.5, gy + 0.5, gw - 1, gh - 1, 16);
    ctx.stroke();

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

async function renderLeaderboard(data) {
  ensureFonts();
  const rows = data.rows.slice(0, 10);
  const W = 900;
  const HEADER = 96;
  const ROW = 64;
  const PAD_BOTTOM = 22;
  const H = HEADER + rows.length * ROW + PAD_BOTTOM;
  const { canvas, ctx } = makeCanvas(W, H);

  paintBackground(ctx, W, H, 110, 40);
  drawCrescent(ctx, 56, 52, 16, COLORS.ember, 1);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.paper;
  ctx.font = '30px CardSansBold, CardFallbackBold';
  ctx.fillText(data.heading || 'Таблица лидеров', 90, 52);
  ctx.fillStyle = COLORS.fog;
  ctx.font = '15px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, data.title || '', 600), 90, 76);
  if (data.pages > 1) {
    ctx.textAlign = 'right';
    ctx.font = '16px CardMonoBold, CardFallbackBold';
    ctx.fillText(`стр. ${data.page} / ${data.pages}`, W - 52, 60);
    ctx.textAlign = 'left';
  }

  const medal = [COLORS.ember, COLORS.silver, COLORS.bronze];
  const maxXp = Math.max(1, Number(data.maxXp) || 0, ...rows.map((r) => Number(r.xp) || 0));

  const avatars = await Promise.all(
    rows.map(async (r) => {
      try {
        return r.avatarURL ? await loadAvatar(r.avatarURL) : null;
      } catch {
        return null;
      }
    })
  );

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const y = HEADER + i * ROW;
    const mid = y + ROW / 2;

    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      roundRect(ctx, 24, y + 4, W - 48, ROW - 8, 14);
      ctx.fill();
    }

    // Rank badge
    const top3 = r.rank <= 3;
    if (top3) {
      ctx.fillStyle = medal[r.rank - 1];
      ctx.beginPath();
      ctx.arc(62, mid, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14161b';
    } else {
      ctx.fillStyle = COLORS.fog;
    }
    ctx.font = '16px CardMonoBold, CardFallbackBold';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(r.rank), 62, mid + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Avatar
    const ax = 116;
    if (avatars[i]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax, mid, 22, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatars[i], ax - 22, mid - 22, 44, 44);
      ctx.restore();
    } else {
      await drawAvatar(ctx, null, r.name, ax, mid, 22);
    }
    if (top3) {
      ctx.strokeStyle = medal[r.rank - 1];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, mid, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name + xp bar
    ctx.fillStyle = COLORS.paper;
    ctx.font = '20px CardSansBold, CardFallbackBold';
    ctx.fillText(truncateToWidth(ctx, r.name, 480), 156, mid - 4);

    const bx = 156;
    const bw = 520;
    const by = mid + 8;
    ctx.fillStyle = COLORS.track;
    roundRect(ctx, bx, by, bw, 6, 3);
    ctx.fill();
    const w = Math.max(6, (bw * (Number(r.xp) || 0)) / maxXp);
    ctx.fillStyle = top3 ? medal[r.rank - 1] : COLORS.emberDeep;
    roundRect(ctx, bx, by, w, 6, 3);
    ctx.fill();

    // Level + XP, right aligned
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.ember;
    ctx.font = '24px CardMonoBold, CardFallbackBold';
    ctx.fillText(r.sub || `ур. ${r.level}`, W - 52, mid - 2);
    ctx.fillStyle = COLORS.fog;
    ctx.font = '14px CardMonoBold, CardFallbackBold';
    ctx.fillText(r.small || `${fmt(r.xp)} XP`, W - 52, mid + 18);
    ctx.textAlign = 'left';
  }

  return canvas.encode('png');
}

module.exports = { renderRankCard, renderLeaderboard, cardKit: { ensureFonts, makeCanvas, paintBackground, drawAvatar, drawCrescent, truncateToWidth, COLORS } };
