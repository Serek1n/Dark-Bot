const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Забанить участника')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого забанить').setRequired(true))
    .addStringOption((opt) => opt.setName('причина').setDescription('Причина'))
    .addIntegerOption((opt) => opt.setName('дней_удалить').setDescription('Удалить сообщения за N дней (0-7)').setMinValue(0).setMaxValue(7)),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const reason = interaction.options.getString('причина') || 'Без причины';
    const deleteDays = interaction.options.getInteger('дней_удалить') || 0;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && !member.bannable) return interaction.reply({ embeds: [embeds.error('Не могу забанить этого участника.')], ephemeral: true });

    await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
    await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'ban', reason });

    await interaction.reply({ embeds: [embeds.success(`<@${target.id}> забанен(а): ${reason}`)] });
  }
};
