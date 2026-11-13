const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');
const config = require('../../modules/econ/config');
const deals = require('../../modules/econ/deals');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deal')
    .setDescription('Сделка с гарантом: бот держит деньги, пока обе стороны не подтвердят')
    .addUserOption((o) => o.setName('user').setDescription('Кто выполняет работу (продавец)').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Сколько заплатить').setRequired(true).setMinValue(1).setMaxValue(1000000000))
    .addStringOption((o) => o.setName('what').setDescription('Что нужно сделать, например «нарисую аватар»').setRequired(true).setMaxLength(120)),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const settings = await getOrCreateSettings(guildId);
    const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    if (!config.isOn(settings, 'deals')) return interaction.reply({ embeds: [embeds.info('Сделки с гарантом на этом сервере выключены. Администратор может включить их в панели: Экономика.')], flags: MessageFlags.Ephemeral });
    const seller = interaction.options.getUser('user', true);
    if (seller.id === interaction.user.id) return deny('Сделку нельзя открыть с самим собой.');
    const refused = await require('../../utils/memberGate').refuseTarget(interaction, seller, { bots: 'Сделку нельзя открыть с ботом.' });
    if (refused) return deny(refused);
    const amount = interaction.options.getInteger('amount', true);
    const r = await deals.open(settings, guildId, interaction.user.id, seller.id, amount, interaction.options.getString('what', true), interaction.channelId);
    if (r.error) return deny('Недостаточно средств: сумма сделки замораживается сразу.');
    await interaction.reply(deals.view(r.deal, settings));
    const msg = await interaction.fetchReply().catch(() => null);
    if (msg) await r.deal.update({ messageId: msg.id });
    require('../../utils/scheduler').poke('economy');
  }
};
