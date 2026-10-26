// The picture that goes with the welcome message: the new member's avatar, a greeting and the member count.
const { cardKit } = require('./rankCard');

async function renderWelcomeCard({ username, avatarURL, serverName, memberCount }) {
  const { ensureFonts, makeCanvas, paintBackground, drawAvatar, drawCrescent, truncateToWidth, COLORS } = cardKit;
  ensureFonts();
  const W = 900;
  const H = 300;
  const { canvas, ctx } = makeCanvas(W, H);

  paintBackground(ctx, W, H, 150, 150);
  drawCrescent(ctx, W - 38, 38, 14, COLORS.ember, 0.55);

  const cx = 150;
  const cy = 150;
  const R = 82;
  await drawAvatar(ctx, avatarURL, username, cx, cy, R);
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.ember;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
  ctx.stroke();

  const left = 270;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ember;
  ctx.font = '22px CardSansBold';
  ctx.fillText('ДОБРО ПОЖАЛОВАТЬ', left, 98);

  ctx.fillStyle = COLORS.paper;
  ctx.font = '44px CardSansBold';
  ctx.fillText(truncateToWidth(ctx, username, W - left - 50), left, 154);

  ctx.fillStyle = COLORS.fog;
  ctx.font = '22px CardSans';
  ctx.fillText(truncateToWidth(ctx, `на сервер ${serverName}`, W - left - 50), left, 196);
  if (memberCount) {
    ctx.fillStyle = COLORS.silver;
    ctx.font = '20px CardSans';
    ctx.fillText(`Вы наш участник № ${memberCount}`, left, 236);
  }
  return canvas.encode('png'); // encoded off the main thread: a join must not freeze the bot and the panel
}

module.exports = { renderWelcomeCard };
