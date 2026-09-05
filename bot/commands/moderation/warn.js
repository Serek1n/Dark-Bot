const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Warning } = require('../../../db');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Выдать предупреждение участнику')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кому выдать предупреждение').setRequired(true))
    .addStringOption((opt) => opt.setName('причина').setDescription('Причина')),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const reason = interaction.options.getString('причина') || 'Без причины';

    await Warning.create({ guildId: interaction.guild.id, userId: target.id, moderatorId: interaction.user.id, reason });
    await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'warn', reason });

    await interaction.reply({ embeds: [embeds.success(`<@${target.id}> получил(а) предупреждение: ${reason}`)] });
    await interaction.client.users
      .send(target.id, `Вы получили предупреждение на сервере **${interaction.guild.name}**: ${reason}`)
      .catch(() => {});
  }
};
