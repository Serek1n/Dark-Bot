const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Замутить участника (timeout)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого замутить').setRequired(true))
    .addIntegerOption((opt) => opt.setName('минуты').setDescription('На сколько минут').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((opt) => opt.setName('причина').setDescription('Причина')),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const minutes = interaction.options.getInteger('минуты');
    const reason = interaction.options.getString('причина') || 'Без причины';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });
    if (!member.moderatable) return interaction.reply({ embeds: [embeds.error('Не могу замутить этого участника (роль выше моей).')], ephemeral: true });

    await member.timeout(minutes * 60 * 1000, reason);
    await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'mute', reason: `${reason} (${minutes} мин)` });

    await interaction.reply({ embeds: [embeds.success(`<@${target.id}> замучен(а) на ${minutes} мин: ${reason}`)] });
  }
};
