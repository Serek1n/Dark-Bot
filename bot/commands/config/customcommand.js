const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { CustomCommand } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('customcommand')
    .setDescription('Управление кастомными командами')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Добавить кастомную команду')
        .addStringOption((opt) => opt.setName('триггер').setDescription('Слово-триггер, без префикса').setRequired(true))
        .addStringOption((opt) => opt.setName('ответ').setDescription('Текст ответа бота').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Удалить кастомную команду').addStringOption((opt) => opt.setName('триггер').setDescription('Слово-триггер').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Список кастомных команд')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const trigger = interaction.options.getString('триггер').toLowerCase();
      const response = interaction.options.getString('ответ');
      await CustomCommand.upsert({ guildId: interaction.guild.id, trigger, response, createdBy: interaction.user.id });
      return interaction.reply({ embeds: [embeds.success(`Команда \`${trigger}\` сохранена.`)], ephemeral: true });
    }

    if (sub === 'remove') {
      const trigger = interaction.options.getString('триггер').toLowerCase();
      const deleted = await CustomCommand.destroy({ where: { guildId: interaction.guild.id, trigger } });
      return interaction.reply({ embeds: [deleted ? embeds.success('Команда удалена.') : embeds.error('Команда не найдена.')], ephemeral: true });
    }

    if (sub === 'list') {
      const commands = await CustomCommand.findAll({ where: { guildId: interaction.guild.id } });
      if (!commands.length) return interaction.reply({ embeds: [embeds.info('Кастомных команд пока нет.')], ephemeral: true });
      const list = commands.map((c) => `\`${c.trigger}\``).join(', ');
      return interaction.reply({ embeds: [embeds.info(list).setTitle('Кастомные команды')], ephemeral: true });
    }
  }
};
