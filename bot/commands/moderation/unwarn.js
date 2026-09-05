const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Warning } = require('../../../db');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Снять предупреждение по номеру (см. /warnings)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((opt) => opt.setName('номер').setDescription('ID предупреждения').setRequired(true)),
  async execute(interaction) {
    const id = interaction.options.getInteger('номер');
    const warning = await Warning.findOne({ where: { id, guildId: interaction.guild.id } });

    if (!warning) {
      return interaction.reply({ embeds: [embeds.error('Предупреждение с таким номером не найдено.')], ephemeral: true });
    }

    await warning.destroy();
    await recordAndAnnounce(interaction.guild, {
      userId: warning.userId,
      moderatorId: interaction.user.id,
      action: 'unwarn',
      reason: `Снято предупреждение #${id}`
    });

    await interaction.reply({ embeds: [embeds.success(`Предупреждение #${id} снято.`)] });
  }
};
