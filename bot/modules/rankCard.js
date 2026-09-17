const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Fonts are bundled in the repo (not relying on whatever happens to be installed
// on the host) so the card renders identically on any VPS. DejaVu Sans has full
// Cyrillic coverage, which matters since usernames/labels are often in Russian.
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'DejaVuSans.ttf'), 'CardSans');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'), 'CardSansBold');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'DejaVuSansMono-Bold.ttf'), 'CardMonoBold');
  fontsRegistered = true;
}

const COLORS = {
  bg: '#14161b',
  panel: '#1a1c22',
  hairline: '#26292f',
  paper: '#ece8e0',
  fog: '#9498a0',
  ember: '#e3a857',
  emberDim: '#7a5a2c',
  track: '#232630'
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Renders a rank/profile card as a PNG buffer.
 * @param {{ username: string, avatarURL: string, level: number, xpIntoLevel: number, xpNeeded: number, balance: number, currencyName: string, messageCount: number }} data
 * @returns {Promise<Buffer>}
 */
async function renderRankCard(data) {
  ensureFonts();

  const W = 900;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background panel
  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  // Subtle ember glow behind the avatar, echoing the web dashboard / login page
  const glow = ctx.createRadialGradient(150, 150, 20, 150, 150, 220);
  glow.addColorStop(0, 'rgba(227,168,87,0.16)');
  glow.addColorStop(1, 'rgba(227,168,87,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Avatar with ember ring
  const avatarCenter = { x: 150, y: 150 };
  const avatarRadius = 88;
  try {
    const avatarImg = await loadImage(data.avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenter.x, avatarCenter.y, avatarRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarCenter.x - avatarRadius, avatarCenter.y - avatarRadius, avatarRadius * 2, avatarRadius * 2);
    ctx.restore();
  } catch {
    // Network hiccup or bad URL — fall back to a plain circle instead of failing the whole card
    ctx.fillStyle = COLORS.panel;
    ctx.beginPath();
    ctx.arc(avatarCenter.x, avatarCenter.y, avatarRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.ember;
  ctx.beginPath();
  ctx.arc(avatarCenter.x, avatarCenter.y, avatarRadius + 2, 0, Math.PI * 2);
  ctx.stroke();

  // Username
  ctx.fillStyle = COLORS.paper;
  ctx.font = '32px CardSansBold';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncateToWidth(ctx, data.username, 380), 300, 90);

  // Level — the hero stat
  ctx.fillStyle = COLORS.ember;
  ctx.font = '72px CardMonoBold';
  ctx.fillText(String(data.level), 300, 175);
  const levelWidth = ctx.measureText(String(data.level)).width;
  ctx.fillStyle = COLORS.fog;
  ctx.font = '22px CardSans';
  ctx.fillText('уровень', 300 + levelWidth + 16, 175);

  // XP progress bar
  const barX = 300;
  const barY = 200;
  const barW = 540;
  const barH = 16;
  ctx.fillStyle = COLORS.track;
  roundRect(ctx, barX, barY, barW, barH, 8);
  ctx.fill();

  const ratio = data.xpNeeded > 0 ? Math.max(0, Math.min(1, data.xpIntoLevel / data.xpNeeded)) : 0;
  if (ratio > 0) {
    const fillGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fillGrad.addColorStop(0, '#c98a3f');
    fillGrad.addColorStop(1, '#f0c078');
    ctx.fillStyle = fillGrad;
    roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, 8);
    ctx.fill();
  }

  ctx.fillStyle = COLORS.fog;
  ctx.font = '18px CardMonoBold';
  ctx.textAlign = 'right';
  ctx.fillText(`${data.xpIntoLevel}/${data.xpNeeded} XP`, barX + barW, barY - 10);
  ctx.textAlign = 'left';

  // Stats row: balance + messages
  const statsY = 255;
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, statsY - 22);
  ctx.lineTo(barX + barW, statsY - 22);
  ctx.stroke();

  ctx.fillStyle = COLORS.paper;
  ctx.font = '22px CardMonoBold';
  ctx.fillText(`${data.balance} ${data.currencyName}`, barX, statsY + 10);
  ctx.fillStyle = COLORS.fog;
  ctx.font = '14px CardSans';
  ctx.fillText('баланс', barX, statsY + 30);

  const balanceLabelWidth = 220;
  ctx.fillStyle = COLORS.paper;
  ctx.font = '22px CardMonoBold';
  ctx.fillText(`${data.messageCount}`, barX + balanceLabelWidth, statsY + 10);
  ctx.fillStyle = COLORS.fog;
  ctx.font = '14px CardSans';
  ctx.fillText('сообщений', barX + balanceLabelWidth, statsY + 30);

  return canvas.encode('png');
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

module.exports = { renderRankCard };
