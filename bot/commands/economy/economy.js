const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');
const { withLock } = require('../../utils/lock');

const cap = (t) => { const x = String(t || ''); return x.charAt(0).toUpperCase() + x.slice(1); };
const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  // Registered as flat commands /balance, /daily and /pay (the grouped `data` below is kept for tests only).
  variants: [
    { sub: 'balance', data: new SlashCommandBuilder().setName('balance').setDescription('Показать ваш баланс: монеты и кристаллы') },
    { sub: 'daily', data: new SlashCommandBuilder().setName('daily').setDescription('Забрать ежедневную награду') },
    {
      sub: 'pay',
      data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Перевести монеты или кристаллы другому участнику')
        .addUserOption((opt) => opt.setName('user').setDescription('Кому перевести').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Сколько перевести').setRequired(true).setMinValue(1))
        .addStringOption((opt) =>
          opt
            .setName('currency')
            .setDescription('Что переводить (по умолчанию — монеты)')
            .addChoices({ name: 'Монеты', value: 'coins' }, { name: 'Кристаллы', value: 'crystals' })
        )
    }
  ],
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Ежедневная награда, баланс и переводы валют')
    .addSubcommand((sub) => sub.setName('balance').setDescription('Показать баланс обеих валют'))
    .addSubcommand((sub) => sub.setName('daily').setDescription('Забрать ежедневную награду'))
    .addSubcommand((sub) =>
      sub
        .setName('pay')
        .setDescription('Перевести валюту другому участнику')
        .addUserOption((opt) => opt.setName('user').setDescription('Кому перевести').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Сколько перевести').setRequired(true).setMinValue(1))
        .addStringOption((opt) =>
          opt
            .setName('currency')
            .setDescription('Что переводить (по умолчанию — монеты)')
            .addChoices({ name: 'Монеты', value: 'coins' }, { name: 'Кристаллы', value: 'crystals' })
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'balance') {
      const profile = await getOrCreateProfile(interaction.guild.id, interaction.user.id);
      const settings = await getOrCreateSettings(interaction.guild.id);
      const embed = embeds
        .baseEmbed()
        .setTitle('Баланс')
        .addFields(
          { name: cap(settings.currencyName), value: `${profile.balance}`, inline: true },
          { name: cap(settings.crystalName), value: `${profile.crystals}`, inline: true }
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

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
        // Streak: claiming again within 48 hours of the previous claim continues it, otherwise it restarts.
        const last = profile.lastDailyAt ? new Date(profile.lastDailyAt).getTime() : 0;
        const streak = last && Date.now() - last < 2 * DAY_MS ? Number(profile.dailyStreak || 0) + 1 : 1;
        const base = Math.max(0, Number(settings.dailyCoins) || 0);
        const maxDays = Math.max(1, Number(settings.dailyStreakMax) || 1);
        const bonus = Math.max(0, Number(settings.dailyStreakBonus) || 0) * (Math.min(streak, maxDays) - 1);
        const amount = base + bonus;
        profile.balance = Number(profile.balance) + amount;
        profile.dailyStreak = streak;
        profile.lastDailyAt = new Date();
        await profile.save();
        return { balance: profile.balance, currency: settings.currencyName, amount, base, bonus, streak };
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
        .setDescription(
          result.streak > 1
            ? `Серия: **${result.streak} дн.** подряд${result.bonus ? ` (бонус +${result.bonus})` : ''}. Возвращайтесь через 24 часа, чтобы не прервать её.`
            : 'Возвращайтесь завтра: за каждый день подряд бонус растёт.'
        )
        .addFields(
          { name: 'Получено', value: `+${result.amount} ${result.currency}`, inline: true },
          { name: 'Баланс', value: `${result.balance} ${result.currency}`, inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'pay') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      if (target.id === interaction.user.id) return interaction.reply({ embeds: [embeds.error('Нельзя перевести самому себе.')], flags: MessageFlags.Ephemeral });
      if (target.bot) return interaction.reply({ embeds: [embeds.error('Нельзя перевести боту.')], flags: MessageFlags.Ephemeral });

      const guildId = interaction.guild.id;
      const settings = await getOrCreateSettings(guildId);
      const crystals = interaction.options.getString('currency') === 'crystals';
      const field = crystals ? 'crystals' : 'balance';
      const currency = crystals ? settings.crystalName : settings.currencyName;
      // One transfer at a time per server: the balance check and both writes must not interleave.
      const ok = await withLock(`pay:${guildId}`, async () => {
        const sender = await getOrCreateProfile(guildId, interaction.user.id);
        const receiver = await getOrCreateProfile(guildId, target.id);
        if (Number(sender[field]) < amount) return false;
        sender[field] = Number(sender[field]) - amount;
        receiver[field] = Number(receiver[field]) + amount;
        await sender.save();
        await receiver.save();
        return true;
      });
      if (!ok) return interaction.reply({ embeds: [embeds.error('Недостаточно средств.')], flags: MessageFlags.Ephemeral });

      const embed = embeds
        .baseEmbed(embeds.COLORS.success)
        .setTitle('✓ Перевод выполнен')
        .setDescription(`<@${interaction.user.id}> → <@${target.id}>`)
        .addFields({ name: 'Сумма', value: `${amount} ${currency}`, inline: true });
      return interaction.reply({ embeds: [embed] });
    }
  }
};
