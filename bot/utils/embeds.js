const { EmbedBuilder } = require('discord.js');

// Matches the web dashboard's design tokens (see web/public/css/style.css)
// so the bot's replies and the panel feel like one product.
const COLORS = {
  primary: 0xe3a857, // ember — brand accent
  success: 0x5cb98a,
  danger: 0xe5686c,
  warning: 0xe3a857,
  neutral: 0x2b2d31 // near-black, for low-emphasis / quiet responses
};

function baseEmbed(color = COLORS.primary) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

function success(description) {
  return baseEmbed(COLORS.success).setDescription(`✅ ${description}`);
}

function error(description) {
  return baseEmbed(COLORS.danger).setDescription(`❌ ${description}`);
}

function info(description) {
  return baseEmbed(COLORS.primary).setDescription(description);
}

// Renders a compact unicode progress bar, e.g. ▰▰▰▰▱▱▱▱▱▱ — used for XP progress.
function progressBar(current, max, length = 10) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filled = Math.round(ratio * length);
  return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

module.exports = { COLORS, baseEmbed, success, error, info, progressBar };
