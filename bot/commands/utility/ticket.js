const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isAdmin } = require('../../utils/permissions');
const { getOrCreateSettings } = require('../../modules/leveling');
const { panelPayload, closeTicket, changeAccess } = require('../../modules/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Обращения к команде сервера в приватных каналах')
    .addSubcommand((s) => s.setName('panel').setDescription('Разместить сообщение с кнопкой «Создать обращение» (для администраторов)')
      .addChannelOption((o) => o.setName('channel').setDescription('Куда поместить (по умолчанию — этот канал)')))
    .addSubcommand((s) => s.setName('close').setDescription('Закрыть обращение, в котором вы находитесь'))
    .addSubcommand((s) => s.setName('add').setDescription('Добавить участника в это обращение').addUserOption((o) => o.setName('user').setDescription('Кого добавить').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Убрать участника из этого обращения').addUserOption((o) => o.setName('user').setDescription('Кого убрать').setRequired(true))),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [embeds.error('Обращения работают только на сервере.')], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'close') return closeTicket(interaction);
    if (sub === 'add' || sub === 'remove') return changeAccess(interaction, interaction.options.getUser('user', true), sub === 'add');

    if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [embeds.error('Разместить панель могут только администраторы сервера.')], flags: MessageFlags.Ephemeral });
    const target = interaction.options.getChannel('channel') || interaction.channel;
    if (!target?.send) return interaction.reply({ embeds: [embeds.error('В этот канал нельзя отправить сообщение.')], flags: MessageFlags.Ephemeral });
    const settings = await getOrCreateSettings(interaction.guild.id);
    await target.send(panelPayload(settings));
    const hint = settings.ticketCategoryId ? '' : ' Категорию и роль команды можно выбрать в веб-панели на странице «Обращения».';
    return interaction.reply({ embeds: [embeds.success(`Панель размещена в <#${target.id}>.${hint}`)], flags: MessageFlags.Ephemeral });
  }
};
