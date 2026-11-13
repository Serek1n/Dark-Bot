const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getOrCreateSettings, getOrCreateProfile } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');
const config = require('../../modules/econ/config');
const gifts = require('../../modules/econ/gifts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Подарочные коды: создать код на сумму или забрать подарок')
    .addSubcommand((s) => s.setName('create').setDescription('Сделать одноразовый код на сумму из своего баланса')
      .addIntegerOption((o) => o.setName('amount').setDescription('Сумма подарка').setRequired(true).setMinValue(1).setMaxValue(1000000000)))
    .addSubcommand((s) => s.setName('redeem').setDescription('Забрать подарок по коду')
      .addStringOption((o) => o.setName('code').setDescription('Код, например DARK-AB3K-9QXZ').setRequired(true).setMaxLength(40))),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const settings = await getOrCreateSettings(guildId);
    const say = (e) => interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    if (!config.isOn(settings, 'gifts')) return say(embeds.info('Подарочные коды на этом сервере выключены. Администратор может включить их в панели: Экономика.'));
    const p = config.params(settings, 'gifts');
    if (interaction.options.getSubcommand() === 'create') {
      const amount = interaction.options.getInteger('amount', true);
      const r = await gifts.create(guildId, interaction.user.id, amount, p);
      if (r.error === 'min') return say(embeds.error(`Код можно сделать на сумму от ${p.minAmount} ${settings.currencyName}.`));
      if (r.error === 'limit') return say(embeds.error(`Сегодня вы уже сделали ${p.maxPerDay} кодов — это предел на сутки.`));
      if (r.error) return say(embeds.error('Недостаточно средств.'));
      return say(embeds.success(`Код на **${amount} ${settings.currencyName}**:\n\`${r.code}\`\n\nОтдайте его кому угодно: подарок заберёт тот, кто первым введёт \`/gift redeem\`. Деньги уже списаны с вашего баланса.`));
    }
    // redeem: a newcomer by the protection's rules can't, so a fresh second account is no use
    if (config.isOn(settings, 'protect')) {
      const prot = config.params(settings, 'protect');
      const profile = await getOrCreateProfile(guildId, interaction.user.id);
      if (require('../../modules/econ/pay').isNewbie(interaction.member, profile.level, prot)) return say(embeds.error(`Подарочные коды можно забирать, когда пробудете на сервере ${prot.newbieDays} дн. и дорастёте до ${prot.newbieLevel} уровня.`));
    }
    const r = await gifts.redeem(guildId, interaction.user.id, interaction.options.getString('code', true));
    if (r.error === 'unknown') return say(embeds.error('Такого кода нет. Проверьте, нет ли опечатки.'));
    if (r.error === 'used') return say(embeds.error('Этот код уже использован.'));
    if (r.error === 'own') return say(embeds.error('Свой собственный код забрать нельзя — отдайте его другу.'));
    return say(embeds.success(`Подарок получен: **+${r.amount} ${settings.currencyName}**${r.creatorId ? ` от <@${r.creatorId}>` : ''}.`));
  }
};
