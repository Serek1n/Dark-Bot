const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Alert } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removealert')
    .setDescription('Удалить подписку на оповещения')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt.setName('платформа').setDescription('youtube или twitch').setRequired(true).addChoices({ name: 'YouTube', value: 'youtube' }, { name: 'Twitch', value: 'twitch' })
    )
    .addStringOption((opt) => opt.setName('идентификатор').setDescription('ID YouTube-канала или логин Twitch').setRequired(true)),
  async execute(interaction) {
    const platform = interaction.options.getString('платформа');
    const targetId = interaction.options.getString('идентификатор').toLowerCase();

    const deleted = await Alert.destroy({ where: { guildId: interaction.guild.id, platform, targetId } });
    await interaction.reply({
      embeds: [deleted ? embeds.success('Подписка удалена.') : embeds.error('Подписка не найдена.')],
      ephemeral: true
    });
  }
};
