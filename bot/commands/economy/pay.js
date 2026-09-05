const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Перевести валюту другому участнику')
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Кому перевести').setRequired(true))
    .addIntegerOption((opt) => opt.setName('сумма').setDescription('Сколько перевести').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const amount = interaction.options.getInteger('сумма');

    if (target.id === interaction.user.id) {
      return interaction.reply({ embeds: [embeds.error('Нельзя перевести самому себе.')], ephemeral: true });
    }
    if (target.bot) {
      return interaction.reply({ embeds: [embeds.error('Нельзя перевести боту.')], ephemeral: true });
    }

    const [sender, receiver, settings] = await Promise.all([
      getOrCreateProfile(interaction.guild.id, interaction.user.id),
      getOrCreateProfile(interaction.guild.id, target.id),
      getOrCreateSettings(interaction.guild.id)
    ]);

    if (Number(sender.balance) < amount) {
      return interaction.reply({ embeds: [embeds.error('Недостаточно средств.')], ephemeral: true });
    }

    sender.balance = Number(sender.balance) - amount;
    receiver.balance = Number(receiver.balance) + amount;
    await Promise.all([sender.save(), receiver.save()]);

    await interaction.reply({
      embeds: [embeds.success(`<@${interaction.user.id}> перевёл(а) **${amount} ${settings.currencyName}** пользователю <@${target.id}>`)]
    });
  }
};
