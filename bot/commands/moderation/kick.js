const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Кикнуть участника')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого кикнуть').setRequired(true))
    .addStringOption((opt) => opt.setName('причина').setDescription('Причина')),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const reason = interaction.options.getString('причина') || 'Без причины';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });
    if (!member.kickable) return interaction.reply({ embeds: [embeds.error('Не могу кикнуть этого участника.')], ephemeral: true });

    await member.kick(reason);
    await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'kick', reason });

    await interaction.reply({ embeds: [embeds.success(`<@${target.id}> кикнут(а): ${reason}`)] });
  }
};
