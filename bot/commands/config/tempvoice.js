const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Настройка временных голосовых каналов')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Указать канал "Войти чтобы создать"')
        .addChannelOption((opt) => opt.setName('канал').setDescription('Голосовой канал-триггер').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
        .addChannelOption((opt) => opt.setName('категория').setDescription('Категория для новых каналов').addChannelTypes(ChannelType.GuildCategory))
        .addStringOption((opt) => opt.setName('шаблон_имени').setDescription('Используйте {user}, например "Комната {user}"'))
    )
    .addSubcommand((sub) => sub.setName('disable').setDescription('Отключить временные голосовые каналы')),
  async execute(interaction) {
    const settings = await getOrCreateSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      settings.tempVoiceJoinChannelId = interaction.options.getChannel('канал').id;
      const category = interaction.options.getChannel('категория');
      if (category) settings.tempVoiceCategoryId = category.id;
      const template = interaction.options.getString('шаблон_имени');
      if (template) settings.tempVoiceNameTemplate = template;
      await settings.save();
      return interaction.reply({ embeds: [embeds.success('Временные голосовые каналы настроены.')] });
    }

    if (sub === 'disable') {
      settings.tempVoiceJoinChannelId = null;
      settings.tempVoiceCategoryId = null;
      await settings.save();
      return interaction.reply({ embeds: [embeds.success('Временные голосовые каналы отключены.')] });
    }
  }
};
