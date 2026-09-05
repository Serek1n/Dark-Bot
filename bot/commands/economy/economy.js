const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

const DAILY_AMOUNT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Ежедневная награда и переводы валюты')
    .addSubcommand((sub) => sub.setName('daily').setDescription('Забрать ежедневную награду'))
    .addSubcommand((sub) =>
      sub
        .setName('pay')
        .setDescription('Перевести валюту другому участнику')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кому перевести').setRequired(true))
        .addIntegerOption((opt) => opt.setName('сумма').setDescription('Сколько перевести').setRequired(true).setMinValue(1))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'daily') {
      const [profile, settings] = await Promise.all([
        getOrCreateProfile(interaction.guild.id, interaction.user.id),
        getOrCreateSettings(interaction.guild.id)
      ]);

      if (profile.lastDailyAt && Date.now() - new Date(profile.lastDailyAt).getTime() < DAY_MS) {
        const remaining = DAY_MS - (Date.now() - new Date(profile.lastDailyAt).getTime());
        const hours = Math.ceil(remaining / (60 * 60 * 1000));
        return interaction.reply({ embeds: [embeds.error(`Вы уже забирали награду сегодня. Попробуйте через ~${hours} ч.`)], ephemeral: true });
      }

      profile.balance = Number(profile.balance) + DAILY_AMOUNT;
      profile.lastDailyAt = new Date();
      await profile.save();

      return interaction.reply({ embeds: [embeds.success(`Вы получили **${DAILY_AMOUNT} ${settings.currencyName}**! Баланс: ${profile.balance}`)] });
    }

    if (sub === 'pay') {
      const target = interaction.options.getUser('пользователь');
      const amount = interaction.options.getInteger('сумма');

      if (target.id === interaction.user.id) return interaction.reply({ embeds: [embeds.error('Нельзя перевести самому себе.')], ephemeral: true });
      if (target.bot) return interaction.reply({ embeds: [embeds.error('Нельзя перевести боту.')], ephemeral: true });

      const [sender, receiver, settings] = await Promise.all([
        getOrCreateProfile(interaction.guild.id, interaction.user.id),
        getOrCreateProfile(interaction.guild.id, target.id),
        getOrCreateSettings(interaction.guild.id)
      ]);

      if (Number(sender.balance) < amount) return interaction.reply({ embeds: [embeds.error('Недостаточно средств.')], ephemeral: true });

      sender.balance = Number(sender.balance) - amount;
      receiver.balance = Number(receiver.balance) + amount;
      await Promise.all([sender.save(), receiver.save()]);

      return interaction.reply({ embeds: [embeds.success(`<@${interaction.user.id}> перевёл(а) **${amount} ${settings.currencyName}** пользователю <@${target.id}>`)] });
    }
  }
};
