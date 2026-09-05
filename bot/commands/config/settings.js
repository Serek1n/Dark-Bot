const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Общие настройки бота на сервере')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('logchannel')
        .setDescription('Канал для журнала модерации')
        .addChannelOption((opt) => opt.setName('канал').setDescription('Канал').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('reportchannel')
        .setDescription('Канал для жалоб участников')
        .addChannelOption((opt) => opt.setName('канал').setDescription('Канал').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('levelupchannel')
        .setDescription('Канал для объявлений о новом уровне (по умолчанию — текущий канал)')
        .addChannelOption((opt) => opt.setName('канал').setDescription('Канал').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('welcome')
        .setDescription('Настроить приветствие новых участников')
        .addChannelOption((opt) => opt.setName('канал').setDescription('Канал приветствия').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((opt) => opt.setName('сообщение').setDescription('Используйте {user} и {server}'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('autorole')
        .setDescription('Роль, выдаваемая автоматически при входе')
        .addRoleOption((opt) => opt.setName('роль').setDescription('Роль').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('prefix')
        .setDescription('Префикс для текстовых команд (кастомные команды)')
        .addStringOption((opt) => opt.setName('префикс').setDescription('Например !').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('currency')
        .setDescription('Название валюты сервера')
        .addStringOption((opt) => opt.setName('название').setDescription('Например монеты').setRequired(true))
    ),
  async execute(interaction) {
    const settings = await getOrCreateSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'logchannel') {
      settings.modLogChannelId = interaction.options.getChannel('канал').id;
    } else if (sub === 'reportchannel') {
      settings.reportChannelId = interaction.options.getChannel('канал').id;
    } else if (sub === 'levelupchannel') {
      settings.levelUpChannelId = interaction.options.getChannel('канал').id;
    } else if (sub === 'welcome') {
      settings.welcomeChannelId = interaction.options.getChannel('канал').id;
      const msg = interaction.options.getString('сообщение');
      if (msg) settings.welcomeMessage = msg;
    } else if (sub === 'autorole') {
      settings.autoRoleId = interaction.options.getRole('роль').id;
    } else if (sub === 'prefix') {
      settings.prefix = interaction.options.getString('префикс');
    } else if (sub === 'currency') {
      settings.currencyName = interaction.options.getString('название');
    }

    await settings.save();
    await interaction.reply({ embeds: [embeds.success('Настройки обновлены. Их также можно менять в веб-панели.')] });
  }
};
