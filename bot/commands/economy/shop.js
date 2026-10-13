const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildShopPanel } = require('../../modules/shop');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Магазин сервера: потратить монеты и кристаллы'),

  async execute(interaction) {
    const panel = await buildShopPanel(interaction.guild, interaction.user.id);
    if (panel.error) return interaction.reply({ embeds: [embeds.info(panel.error)], flags: MessageFlags.Ephemeral });
    return interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
  }
};
