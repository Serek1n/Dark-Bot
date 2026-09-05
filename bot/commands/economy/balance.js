const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Показать баланс валюты')
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Чей баланс показать')),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь') || interaction.user;
    const [profile, settings] = await Promise.all([
      getOrCreateProfile(interaction.guild.id, target.id),
      getOrCreateSettings(interaction.guild.id)
    ]);
    await interaction.reply({
      embeds: [embeds.info(`💰 У <@${target.id}> на балансе: **${profile.balance} ${settings.currencyName}**`)]
    });
  }
};
