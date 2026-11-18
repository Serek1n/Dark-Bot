// Picture cards added with «Оформление»: the level-up card and the result of a mini-game. Drawn in the server's theme
// (bot/modules/appearance.js → palette) with the same kit as the profile card, so all the bot's pictures look alike.
const { cardKit } = require('./rankCard');

const { ensureFonts, makeCanvas, paintCard, paintTile, drawSquareAvatar, truncateToWidth, roundRect, fmt, COLORS } = cardKit;

// «Широкий» format (appearance.js → FORMATS): the picture is 1140 × 302, the plate sits 16 px from the top and left and
// 31 px from the bottom and right (MEE6's proportions); the empty space stays transparent and holds the soft shadow.
const WIDE = { W: 1140, H: 302, top: 16, left: 16, bottom: 31, right: 31 };
WIDE.plateW = WIDE.W - WIDE.left - WIDE.right; // 1093
WIDE.plateH = WIDE.H - WIDE.top - WIDE.bottom; // 255

/**
 * A canvas for a card of this format. Returns { canvas, ctx, W, H }: W × H is the plate to draw on (the context is moved
 * onto it), already painted. «classic» — the plate is the whole picture (w × h).
 */
function openCard(format, w, h, C, radius = 24) {
  if (format !== 'wide') {
    const { canvas, ctx } = makeCanvas(w, h);
    paintCard(ctx, w, h, C);
    return { canvas, ctx, W: w, H: h };
  }
  const { canvas, ctx } = makeCanvas(WIDE.W, WIDE.H);
  const W = WIDE.plateW; const H = WIDE.plateH;
  ctx.translate(WIDE.left, WIDE.top);
  ctx.save(); // the shadow falls down and to the right, inside the wider bottom and right margins
  ctx.shadowColor = C.light ? 'rgba(40,30,20,0.28)' : 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 7;
  ctx.fillStyle = C.bg; roundRect(ctx, 0, 0, W, H, radius); ctx.fill();
  ctx.restore();
  paintCard(ctx, W, H, C);
  return { canvas, ctx, W, H };
}

const mark = (ctx, C, x, y, text) => { // the small accent line with a caption: «НОВЫЙ УРОВЕНЬ»
  ctx.fillStyle = C.ember; roundRect(ctx, x, y - 13, 4, 16, 2); ctx.fill();
  ctx.font = '15px CardSansBold, CardFallbackBold'; ctx.fillText(text, x + 14, y);
};

/**
 * «НОВЫЙ УРОВЕНЬ»: the avatar in an accent frame, the headline, the name, "11 → 12" and what the level gave, and the level
 * itself in a ring on the right.
 * @param {{ username: string, avatarURL?: string, level: number, oldLevel?: number, reward?: string, server?: string,
 *   headline?: string, colors?: object }} d
 */
async function renderLevelUpCard(d) {
  ensureFonts();
  const C = d.colors || COLORS;
  const wide = d.format === 'wide';
  const { canvas, ctx, W, H } = openCard(d.format, 900, 260, C);
  // a soft glow of the accent behind the ring
  ctx.save(); roundRect(ctx, 0, 0, W, H, 24); ctx.clip();
  const glow = ctx.createRadialGradient(W - 140, H / 2, 10, W - 140, H / 2, 220);
  glow.addColorStop(0, `${C.ember}40`); glow.addColorStop(1, `${C.ember}00`);
  ctx.fillStyle = glow; ctx.fillRect(W - 380, 0, 380, H);
  if (wide) { // the wide plate: an accent line along the left edge
    ctx.fillStyle = C.ember; ctx.fillRect(0, 0, 6, H);
  }
  ctx.restore();

  const size = wide ? 156 : 150;
  await drawSquareAvatar(ctx, d.avatarURL, d.username, wide ? 50 : 44, (H - size) / 2, size, 30, undefined, 4, C);

  const left = wide ? 246 : 232; const ringX = W - 140; const maxW = ringX - 100 - left;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ember; mark(ctx, C, left, 74, truncateToWidth(ctx, d.headline || 'НОВЫЙ УРОВЕНЬ', maxW));
  ctx.fillStyle = C.paper; ctx.font = '40px CardSansBold, CardFallbackBold';
  let px = 40;
  while (px > 26 && ctx.measureText(d.username).width > maxW) { px -= 2; ctx.font = `${px}px CardSansBold, CardFallbackBold`; }
  ctx.fillText(truncateToWidth(ctx, d.username, maxW), left, 126);
  const from = Number.isFinite(Number(d.oldLevel)) ? Number(d.oldLevel) : Math.max(0, d.level - 1);
  ctx.fillStyle = C.fog; ctx.font = '20px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, `Уровень ${fmt(from)} → ${fmt(d.level)}${d.server ? ` · ${d.server}` : ''}`, maxW), left, 162);
  if (d.reward) {
    ctx.font = '15px CardSansBold, CardFallbackBold';
    const text = truncateToWidth(ctx, d.reward, maxW - 30);
    const w = ctx.measureText(text).width + 30;
    ctx.fillStyle = C.raised; roundRect(ctx, left, 184, w, 34, 17); ctx.fill();
    ctx.fillStyle = C.emberLight; ctx.textBaseline = 'middle'; ctx.fillText(text, left + 15, 201.5); ctx.textBaseline = 'alphabetic';
  }

  // the ring with the level
  const r = 78;
  ctx.lineWidth = 10; ctx.strokeStyle = C.track; ctx.beginPath(); ctx.arc(ringX, H / 2, r, 0, Math.PI * 2); ctx.stroke();
  const g = ctx.createLinearGradient(ringX - r, 0, ringX + r, 0); g.addColorStop(0, C.emberDeep); g.addColorStop(1, C.emberLight);
  ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.save(); ctx.shadowColor = `${C.ember}aa`; ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(ringX, H / 2, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); ctx.lineCap = 'butt';
  ctx.fillStyle = C.paper; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lv = fmt(d.level); ctx.font = `${lv.length > 4 ? 34 : lv.length > 2 ? 46 : 58}px CardMonoBold, CardFallbackBold`;
  ctx.fillText(lv, ringX, H / 2 - 6);
  ctx.fillStyle = C.fog; ctx.font = '14px CardSansBold, CardFallbackBold'; ctx.fillText('УРОВЕНЬ', ringX, H / 2 + 32);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return canvas.encode('png');
}

// ---- mini-games ----
const GOOD = '#5cb98a'; const BAD = '#e5686c';

function die(ctx, C, x, y, s, value, sides) { // one die: pips for a d6, the number for any other
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  ctx.fillStyle = C.light ? '#ffffff' : C.raised; roundRect(ctx, x, y, s, s, s * 0.2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = `${C.ember}88`; ctx.lineWidth = 2; roundRect(ctx, x + 1, y + 1, s - 2, s - 2, s * 0.2); ctx.stroke();
  if (sides === 6 && value >= 1 && value <= 6) {
    const P = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[value];
    ctx.fillStyle = C.ember;
    for (const [i, j] of P) { ctx.beginPath(); ctx.arc(x + s * (0.27 + i * 0.23), y + s * (0.27 + j * 0.23), s * 0.085, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = C.ember; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = String(value); ctx.font = `${Math.round(s * (t.length > 3 ? 0.3 : t.length > 2 ? 0.36 : 0.46))}px CardMonoBold, CardFallbackBold`;
    ctx.fillText(t, x + s / 2, y + s / 2 + 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
}

function glyph(ctx, C, kind, cx, cy, s, color) { // rock, paper, scissors as simple line pictures
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = `${color}22`; ctx.lineWidth = s * 0.07; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (kind === 'rock') {
    ctx.beginPath(); ctx.moveTo(cx - s * 0.42, cy + s * 0.2); ctx.lineTo(cx - s * 0.3, cy - s * 0.22); ctx.lineTo(cx - s * 0.02, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.32, cy - s * 0.26); ctx.lineTo(cx + s * 0.44, cy + s * 0.08); ctx.lineTo(cx + s * 0.24, cy + s * 0.36); ctx.lineTo(cx - s * 0.22, cy + s * 0.38); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (kind === 'paper') {
    roundRect(ctx, cx - s * 0.3, cy - s * 0.4, s * 0.6, s * 0.8, s * 0.06); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(cx - s * 0.18, cy - s * 0.2 + i * s * 0.14); ctx.lineTo(cx + s * 0.18, cy - s * 0.2 + i * s * 0.14); ctx.stroke(); }
  } else {
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * s * 0.2, cy + s * 0.26, s * 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - s * 0.12, cy + s * 0.15); ctx.lineTo(cx + s * 0.26, cy - s * 0.42); ctx.moveTo(cx + s * 0.12, cy + s * 0.15); ctx.lineTo(cx - s * 0.26, cy - s * 0.42); ctx.stroke();
  }
  ctx.restore();
}

/**
 * The result of a mini-game as a picture.
 * d.game: 'dice' {rolls, sides} | 'coinflip' {heads} | '8ball' {question, answer, mood} | 'rps' {you, bot, result};
 * d.player: the name of who played (top right).
 */
async function renderGameCard(d) {
  ensureFonts();
  const C = d.colors || COLORS;
  const W = 900; const H = 300;
  const { canvas, ctx } = makeCanvas(W, H);
  paintCard(ctx, W, H, C);
  const left = 44; const right = W - 44;
  const TITLES = { dice: 'КУБИК', coinflip: 'МОНЕТКА', '8ball': 'ШАР ПРЕДСКАЗАНИЙ', rps: 'КАМЕНЬ, НОЖНИЦЫ, БУМАГА' };
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ember; mark(ctx, C, left, 58, TITLES[d.game] || 'МИНИ-ИГРА');
  ctx.fillStyle = C.fog; ctx.font = '16px CardSans, CardFallback'; ctx.textAlign = 'right';
  ctx.fillText(truncateToWidth(ctx, d.player || '', 360), right, 58); ctx.textAlign = 'left';

  if (d.game === 'dice') {
    const rolls = (d.rolls || []).slice(0, 10); const shown = rolls.slice(0, 5);
    const s = shown.length > 3 ? 104 : 128; const gap = 22;
    const total = rolls.reduce((a, b) => a + b, 0);
    const blockW = shown.length * s + (shown.length - 1) * gap;
    const sumW = 230; const x0 = left + Math.max(0, (right - left - sumW - blockW) / 2 - 20);
    shown.forEach((v, i) => die(ctx, C, x0 + i * (s + gap), 92 + (128 - s) / 2 + 20, s, v, d.sides));
    ctx.textAlign = 'right'; ctx.fillStyle = C.paper; ctx.font = '72px CardMonoBold, CardFallbackBold';
    ctx.fillText(fmt(total), right, 196);
    ctx.fillStyle = C.fog; ctx.font = '18px CardSans, CardFallback';
    ctx.fillText(truncateToWidth(ctx, rolls.length > 1 ? `сумма ${rolls.length} кубиков d${d.sides}${rolls.length > 5 ? ` (показаны 5)` : ''}` : `из ${d.sides}`, sumW + 60), right, 230);
    ctx.textAlign = 'left';
  } else if (d.game === 'coinflip') {
    const cx = W / 2 - 150; const cy = 172; const r = 86;
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, C.emberLight); g.addColorStop(1, C.emberDeep);
    ctx.save(); ctx.shadowColor = `${C.ember}99`; ctx.shadowBlur = 30; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r - 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.light ? '#ffffff' : C.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '78px CardSansBold, CardFallbackBold';
    ctx.fillText(d.heads ? 'О' : 'Р', cx, cy + 4); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = C.paper; ctx.font = '64px CardSansBold, CardFallbackBold'; ctx.fillText(d.heads ? 'Орёл' : 'Решка', cx + r + 50, 190);
    ctx.fillStyle = C.fog; ctx.font = '18px CardSans, CardFallback'; ctx.fillText('выпало на монетке', cx + r + 52, 224);
  } else if (d.game === '8ball') {
    const cx = left + 96; const cy = 176; const r = 88;
    const g = ctx.createRadialGradient(cx - 26, cy - 30, 6, cx, cy, r); g.addColorStop(0, '#4a4d57'); g.addColorStop(1, '#0b0c10');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const mood = d.mood === 'good' ? GOOD : d.mood === 'bad' ? BAD : C.ember;
    ctx.fillStyle = `${mood}`; ctx.beginPath(); ctx.moveTo(cx, cy - 34); ctx.lineTo(cx + 32, cy + 22); ctx.lineTo(cx - 32, cy + 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0c10'; ctx.font = '22px CardSansBold, CardFallbackBold'; ctx.textAlign = 'center'; ctx.fillText('8', cx, cy + 12); ctx.textAlign = 'left';
    const x = cx + r + 40; const w = right - x;
    ctx.fillStyle = C.fog; ctx.font = '18px CardSans, CardFallback';
    ctx.fillText(truncateToWidth(ctx, `«${d.question || ''}»`, w), x, 132);
    ctx.fillStyle = C.paper; let px = 40; ctx.font = `${px}px CardSansBold, CardFallbackBold`;
    while (px > 24 && ctx.measureText(d.answer || '').width > w) { px -= 2; ctx.font = `${px}px CardSansBold, CardFallbackBold`; }
    ctx.fillText(truncateToWidth(ctx, d.answer || '', w), x, 190);
    ctx.fillStyle = mood; roundRect(ctx, x, 210, 60, 6, 3); ctx.fill();
  } else if (d.game === 'rps') {
    const NAMES = { rock: 'Камень', scissors: 'Ножницы', paper: 'Бумага' };
    const colorOf = { win: GOOD, lose: BAD, draw: C.ember }[d.result] || C.ember;
    const tw = 300; const th = 170; const y = 84;
    const tiles = [[left, 'Вы', d.you, d.result === 'win' ? GOOD : d.result === 'lose' ? C.fog : C.ember], [right - tw, 'Бот', d.bot, d.result === 'lose' ? BAD : d.result === 'win' ? C.fog : C.ember]];
    for (const [x, who, kind, col] of tiles) {
      paintTile(ctx, x, y, tw, th, 18, `${col}88`, C);
      glyph(ctx, C, kind, x + 70, y + th / 2, 92, col);
      ctx.fillStyle = C.fog; ctx.font = '15px CardSansBold, CardFallbackBold'; ctx.fillText(who.toUpperCase(), x + 136, y + 70);
      ctx.fillStyle = C.paper; ctx.font = '26px CardSansBold, CardFallbackBold'; ctx.fillText(truncateToWidth(ctx, NAMES[kind] || kind, tw - 150), x + 136, y + 104);
    }
    ctx.fillStyle = colorOf; ctx.textAlign = 'center'; ctx.font = '40px CardSansBold, CardFallbackBold';
    ctx.fillText({ win: 'Победа!', lose: 'Поражение', draw: 'Ничья' }[d.result] || '', W / 2, y + th / 2 + 2);
    ctx.fillStyle = C.fog; ctx.font = '16px CardSans, CardFallback'; ctx.fillText('против бота', W / 2, y + th / 2 + 30);
    ctx.textAlign = 'left';
  }
  return canvas.encode('png');
}

module.exports = { openCard, WIDE, renderLevelUpCard, renderGameCard };
