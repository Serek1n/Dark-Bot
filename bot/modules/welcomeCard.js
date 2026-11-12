// The picture that goes with the welcome message, in the profile card's style: the new member's avatar in
// an ember frame, a greeting, their name, the server and the member count.
const { cardKit } = require('./rankCard');

async function renderWelcomeCard({ username, avatarURL, serverName, memberCount }) {
  const { ensureFonts, makeCanvas, paintCard, drawSquareAvatar, truncateToWidth, COLORS } = cardKit;
  ensureFonts();
  const W = 900;
  const H = 300;
  const { canvas, ctx } = makeCanvas(W, H);
  paintCard(ctx, W, H);

  const size = 172;
  await drawSquareAvatar(ctx, avatarURL, username, 48, (H - size) / 2, size, 32);

  const left = 268;
  const maxW = W - left - 44;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COLORS.ember;
  roundRectFill(ctx, left, 76, 4, 16, 2);
  ctx.font = '15px CardSansBold, CardFallbackBold';
  ctx.fillText('ДОБРО ПОЖАЛОВАТЬ', left + 14, 90);

  ctx.fillStyle = COLORS.paper;
  ctx.font = '44px CardSansBold, CardFallbackBold';
  ctx.fillText(truncateToWidth(ctx, username, maxW), left, 146);

  ctx.fillStyle = COLORS.fog;
  ctx.font = '20px CardSans, CardFallback';
  ctx.fillText(truncateToWidth(ctx, `на сервер ${serverName}`, maxW), left, 182);

  if (memberCount) {
    const text = `Вы наш участник № ${memberCount}`;
    ctx.font = '15px CardSansBold, CardFallbackBold';
    const w = Math.min(maxW, ctx.measureText(text).width + 30);
    ctx.fillStyle = COLORS.raised;
    roundRectFill(ctx, left, 204, w, 34, 17);
    ctx.fillStyle = COLORS.emberLight;
    ctx.textBaseline = 'middle';
    ctx.fillText(truncateToWidth(ctx, text, w - 30), left + 15, 221.5);
    ctx.textBaseline = 'alphabetic';
  }
  return canvas.encode('png'); // encoded off the main thread: a join must not freeze the bot and the panel
}

function roundRectFill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

module.exports = { renderWelcomeCard };
