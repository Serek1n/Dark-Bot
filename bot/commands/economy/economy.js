const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');
const { withLock } = require('../../utils/lock');

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
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;
      // Serialised per user so a double-click can't claim the reward twice.
      const result = await withLock(`daily:${guildId}:${userId}`, async () => {
        const profile = await getOrCreateProfile(guildId, userId);
        const settings = await getOrCreateSettings(guildId);
        if (profile.lastDailyAt && Date.now() - new Date(profile.lastDailyAt).getTime() < DAY_MS) {
          const remaining = DAY_MS - (Date.now() - new Date(profile.lastDailyAt).getTime());
          return { wait: remaining };
        }
        profile.balance = Number(profile.balance) + DAILY_AMOUNT;
        profile.lastDailyAt = new Date();
        await profile.save();
        return { balance: profile.balance, currency: settings.currencyName };
      });

      if (result.wait) {
        const h = Math.floor(result.wait / 3600000);
        const m = Math.ceil((result.wait % 3600000) / 60000);
        const left = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
        return interaction.reply({ embeds: [embeds.error(`Награда уже получена. Следующая через ${left}.`)], flags: MessageFlags.Ephemeral });
      }

      const embed = embeds
        .baseEmbed(embeds.COLORS.success)
        .setTitle('✓ Награда получена')
        .setDescription('Возвращайтесь через 24 часа')
        .addFields(
          { name: 'Получено', value: `+${DAILY_AMOUNT} ${result.currency}`, inline: true },
          { name: 'Баланс', value: `${result.balance} ${result.currency}`, inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'pay') {
      const target = interaction.options.getUser('пользователь');
      const amount = interaction.options.getInteger('сумма');

      if (target.id === interaction.user.id) return interaction.reply({ embeds: [embeds.error('Нельзя перевести самому себе.')], flags: MessageFlags.Ephemeral });
      if (target.bot) return interaction.reply({ embeds: [embeds.error('Нельзя перевести боту.')], flags: MessageFlags.Ephemeral });

      const guildId = interaction.guild.id;
      const settings = await getOrCreateSettings(guildId);
      // One transfer at a time per server: the balance check and both writes must not interleave.
      const ok = await withLock(`pay:${guildId}`, async () => {
        const sender = await getOrCreateProfile(guildId, interaction.user.id);
        const receiver = await getOrCreateProfile(guildId, target.id);
        if (Number(sender.balance) < amount) return false;
        sender.balance = Number(sender.balance) - amount;
        receiver.balance = Number(receiver.balance) + amount;
        await sender.save();
        await receiver.save();
        return true;
      });
      if (!ok) return interaction.reply({ embeds: [embeds.error('Недостаточно средств.')], flags: MessageFlags.Ephemeral });

      const embed = embeds
        .baseEmbed(embeds.COLORS.success)
        .setTitle('✓ Перевод выполнен')
        .setDescription(`<@${interaction.user.id}> → <@${target.id}>`)
        .addFields({ name: 'Сумма', value: `${amount} ${settings.currencyName}`, inline: true });
      return interaction.reply({ embeds: [embed] });
    }
  }
};
