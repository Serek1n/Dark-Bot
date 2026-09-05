const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

const DAILY_AMOUNT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Забрать ежедневную награду'),
  async execute(interaction) {
    const [profile, settings] = await Promise.all([
      getOrCreateProfile(interaction.guild.id, interaction.user.id),
      getOrCreateSettings(interaction.guild.id)
    ]);

    if (profile.lastDailyAt && Date.now() - new Date(profile.lastDailyAt).getTime() < DAY_MS) {
      const remaining = DAY_MS - (Date.now() - new Date(profile.lastDailyAt).getTime());
      const hours = Math.ceil(remaining / (60 * 60 * 1000));
      return interaction.reply({
        embeds: [embeds.error(`Вы уже забирали награду сегодня. Попробуйте через ~${hours} ч.`)],
        ephemeral: true
      });
    }

    profile.balance = Number(profile.balance) + DAILY_AMOUNT;
    profile.lastDailyAt = new Date();
    await profile.save();

    await interaction.reply({
      embeds: [embeds.success(`Вы получили **${DAILY_AMOUNT} ${settings.currencyName}**! Баланс: ${profile.balance}`)]
    });
  }
};
