// The /balance card, in the profile card's style: coins and crystals, the place by wealth, the balance over 30 days and the last
// operations. Drawn from the journal, so the line starts at the day the journal began.
const { cardKit } = require('../rankCard');
const ledger = require('./ledger');

const { ensureFonts, makeCanvas, paintCard, paintTile, drawSquareAvatar, truncateToWidth, COLORS } = cardKit;
const fmt = (n) => Math.trunc(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The coin balance at the end of each of the last `days` days, from today's balance and the daily changes. */
function series(balance, deltas, days = 30) {
  const out = [];
  let b = Number(balance) || 0;
  for (let i = 0; i < days; i++) {
    const d = ledger.day(new Date(Date.now() - i * 86400000));
    out.unshift(Math.max(0, b));
    b -= Number(deltas[d] || 0);
  }
  return out;
}

function sectionTitle(ctx, text, x, y) {
  ctx.fillStyle = COLORS.ember; ctx.fillRect(x, y - 12, 4, 14);
  ctx.fillStyle = COLORS.fog; ctx.font = '12px CardSansBold, CardFallbackBold'; ctx.fillText(text, x + 12, y);
}

/**
 * data: { username, avatarURL, balance, crystals, currencyName, crystalName, rank, total, deltas, ops: [{ kind, amount, currency }], badge }
 */
async function renderBalanceCard(data) {
  ensureFonts();
  const W = 900; const H = 440;
  const { canvas, ctx } = makeCanvas(W, H);
  paintCard(ctx, W, H);
  ctx.textBaseline = 'alphabetic';

  await drawSquareAvatar(ctx, data.avatarURL, data.username, 40, 36, 80, 18);
  ctx.fillStyle = COLORS.paper; ctx.font = '28px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, data.username, 260), 144, 70);
  ctx.fillStyle = 'rgba(236,232,224,0.75)'; ctx.font = '15px CardSans, CardFallback';
  const place = data.rank ? `#${fmt(data.rank)} по богатству${data.total ? ` из ${fmt(data.total)}` : ''}` : 'Баланс';
  ctx.fillText(truncateToWidth(ctx, data.badge ? `${place}  ·  ${data.badge}` : place, 270), 144, 98);

  // the two currencies
  const tiles = [[data.balance, data.currencyName || 'монеты'], [data.crystals, data.crystalName || 'кристаллы']];
  tiles.forEach(([v, label], i) => {
    const x = 36 + i * 206; const y = 144;
    paintTile(ctx, x, y, 196, 104);
    sectionTitle(ctx, String(label).toUpperCase(), x + 18, y + 30);
    ctx.fillStyle = i ? COLORS.paper : COLORS.emberLight;
    let size = 34; ctx.font = `${size}px CardMonoBold, CardFallbackBold`;
    while (ctx.measureText(fmt(v)).width > 160 && size > 16) { size -= 2; ctx.font = `${size}px CardMonoBold, CardFallbackBold`; }
    ctx.fillText(fmt(v), x + 18, y + 80);
  });

  // the balance over 30 days
  const cx = 460; const cy = 36; const cw = 404; const ch = 212;
  paintTile(ctx, cx, cy, cw, ch);
  sectionTitle(ctx, 'БАЛАНС ЗА 30 ДНЕЙ', cx + 18, cy + 30);
  const s = series(data.balance, data.deltas || {}, 30);
  const max = Math.max(1, ...s); const min = Math.min(...s);
  const px = cx + 20; const pw = cw - 40; const py = cy + 52; const ph = ch - 76;
  const X = (i) => px + (i / (s.length - 1)) * pw;
  const Y = (v) => py + ph - ((v - min) / Math.max(1, max - min)) * ph;
  ctx.strokeStyle = COLORS.hairline; ctx.lineWidth = 1;
  [0, 0.5, 1].forEach((k) => { ctx.beginPath(); ctx.moveTo(px, py + ph * k); ctx.lineTo(px + pw, py + ph * k); ctx.stroke(); });
  const grad = ctx.createLinearGradient(0, py, 0, py + ph);
  grad.addColorStop(0, 'rgba(227,168,87,0.28)'); grad.addColorStop(1, 'rgba(227,168,87,0)');
  ctx.beginPath(); ctx.moveTo(X(0), py + ph); s.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(s.length - 1), py + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); s.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = COLORS.ember; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = COLORS.emberLight; ctx.beginPath(); ctx.arc(X(s.length - 1), Y(s[s.length - 1]), 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.fog; ctx.font = '12px CardSans, CardFallback';
  ctx.textAlign = 'right'; ctx.fillText(fmt(max), cx + cw - 18, cy + 30); ctx.textAlign = 'left';

  // the last operations
  const oy = 266; const oh = H - oy - 32;
  paintTile(ctx, 36, oy, W - 72, oh);
  sectionTitle(ctx, 'ПОСЛЕДНИЕ ОПЕРАЦИИ', 54, oy + 30);
  const ops = (data.ops || []).slice(0, 6);
  if (!ops.length) {
    ctx.fillStyle = COLORS.fog; ctx.font = '15px CardSans, CardFallback';
    ctx.fillText('Пока пусто: здесь появятся награды, переводы и покупки.', 54, oy + 74);
  }
  const colW = (W - 72 - 36 - 24) / 2;
  ops.forEach((o, i) => {
    const col = i % 2; const row = Math.floor(i / 2);
    const x = 54 + col * (colW + 24); const y = oy + 66 + row * 34;
    const sign = o.amount > 0 ? '+' : '−';
    const cur = o.currency === 'crystals' ? ` ${data.crystalShort || '◆'}` : '';
    const amount = `${sign}${fmt(Math.abs(o.amount))}${cur}`;
    ctx.font = '16px CardMonoBold, CardFallbackBold';
    const aw = ctx.measureText(amount).width;
    ctx.fillStyle = o.amount > 0 ? COLORS.emberLight : COLORS.fog;
    ctx.textAlign = 'right'; ctx.fillText(amount, x + colW, y); ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.paper; ctx.font = '15px CardSans, CardFallback';
    ctx.fillText(truncateToWidth(ctx, `${ledger.kindLabel(o.kind)}${o.daily && o.day ? ` · ${o.day.slice(8, 10)}.${o.day.slice(5, 7)}` : ''}`, colW - aw - 16), x, y);
  });
  return canvas.encode('png');
}

module.exports = { renderBalanceCard, series };
