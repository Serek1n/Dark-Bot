const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Удалить последние сообщения в канале')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) => opt.setName('количество').setDescription('Сколько сообщений удалить (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  async execute(interaction) {
    const amount = interaction.options.getInteger('количество');
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);

    if (!deleted) {
      return interaction.reply({ embeds: [embeds.error('Не удалось удалить сообщения (возможно, они старше 14 дней).')], ephemeral: true });
    }

    await recordAndAnnounce(interaction.guild, {
      userId: interaction.user.id,
      moderatorId: interaction.user.id,
      action: 'clear',
      reason: `Удалено ${deleted.size} сообщений в #${interaction.channel.name}`
    });

    await interaction.reply({ embeds: [embeds.success(`Удалено ${deleted.size} сообщений.`)], ephemeral: true });
  }
};
