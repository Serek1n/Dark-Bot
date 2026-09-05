const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c
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

module.exports = { COLORS, baseEmbed, success, error, info };
