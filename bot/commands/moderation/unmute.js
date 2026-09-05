const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут с участника')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого размутить').setRequired(true)),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });

    await member.timeout(null);
    await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'unmute' });

    await interaction.reply({ embeds: [embeds.success(`<@${target.id}> размучен(а).`)] });
  }
};
