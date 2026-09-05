const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Разбанить участника по ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) => opt.setName('id').setDescription('ID пользователя').setRequired(true)),
  async execute(interaction) {
    const userId = interaction.options.getString('id');

    try {
      await interaction.guild.members.unban(userId);
    } catch {
      return interaction.reply({ embeds: [embeds.error('Не удалось разбанить: пользователь не найден в бан-листе.')], ephemeral: true });
    }

    await recordAndAnnounce(interaction.guild, { userId, moderatorId: interaction.user.id, action: 'unban' });
    await interaction.reply({ embeds: [embeds.success(`Пользователь <@${userId}> разбанен.`)] });
  }
};
