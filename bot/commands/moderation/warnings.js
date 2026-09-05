const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Warning } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Показать предупреждения участника')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого проверить').setRequired(true)),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const warnings = await Warning.findAll({
      where: { guildId: interaction.guild.id, userId: target.id },
      order: [['createdAt', 'DESC']]
    });

    if (!warnings.length) {
      return interaction.reply({ embeds: [embeds.info(`У <@${target.id}> нет предупреждений.`)] });
    }

    const lines = warnings.map((w, i) => `**#${w.id}** — ${w.reason} (от <@${w.moderatorId}>, ${w.createdAt.toLocaleDateString('ru-RU')})`);
    await interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(`Предупреждения ${target.username} (${warnings.length})`)] });
  }
};
