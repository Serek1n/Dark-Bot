const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Op } = require('sequelize');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const ledger = require('../../modules/econ/ledger');
const { sequelize, MemberProfile } = require('../../../db');
const { QueryTypes } = require('sequelize');
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
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;
      const [profile, settings] = await Promise.all([getOrCreateProfile(guildId, userId), getOrCreateSettings(guildId)]);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ebal:hist:${userId}`).setLabel('История операций').setStyle(ButtonStyle.Secondary));
      try {
        const balance = Number(profile.balance) || 0;
        const [rank, total, deltas, ops, badge] = await Promise.all([
          balance > 0 ? MemberProfile.count({ where: { guildId, balance: { [Op.gt]: balance } } }).then((n) => n + 1) : null,
          MemberProfile.count({ where: { guildId, balance: { [Op.gt]: 0 } } }),
          ledger.dailyDeltas(guildId, userId, 30),
          ledger.history(guildId, userId, { limit: 6 }),
          require('../../modules/econ/seasons').badgeText(guildId, userId).catch(() => null)
        ]);
        const png = await require('../../modules/econ/balanceCard').renderBalanceCard({
          username: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          avatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
          balance, crystals: Number(profile.crystals || 0), currencyName: settings.currencyName, crystalName: settings.crystalName,
          rank, total, deltas, ops, badge
        });
        return interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'balance.png' })], components: [button] });
      } catch (err) {
        require('../../utils/logger').error('Balance card failed, falling back to embed:', err);
        const embed = embeds.baseEmbed().setTitle('Баланс').addFields(
          { name: cap(settings.currencyName), value: `${profile.balance}`, inline: true },
          { name: cap(settings.crystalName), value: `${profile.crystals}`, inline: true }
        );
        return interaction.editReply({ embeds: [embed], components: [button] });
      }
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
        // the central bank may make rewards a little smaller while there is too much money (bot/modules/econ/bank.js)
        const amount = Math.round((base + bonus) * require('../../modules/econ/bank').rateOf(settings));
        // Compare-and-set in ONE statement: the reward is paid only if the last claim is still older than a day, so even two
        // processes (the bot and the web panel) can never both pay it, and the coins are added to the balance, not written over it.
        const now = new Date();
        const rows = await sequelize.query(
          `UPDATE member_profiles SET balance = balance + ?, dailyStreak = ?, lastDailyAt = ?, updatedAt = ?
           WHERE guildId = ? AND userId = ? AND (lastDailyAt IS NULL OR lastDailyAt <= ?) RETURNING balance`,
          { replacements: [amount, streak, now, now, guildId, userId, new Date(now.getTime() - DAY_MS)], type: QueryTypes.SELECT }
        );
        if (!rows.length) return { wait: DAY_MS };
        await ledger.record({ guildId, userId, amount, kind: 'daily', note: streak > 1 ? `серия ${streak}` : null }).catch(() => {});
        return { balance: Number(rows[0].balance), currency: settings.currencyName, amount, base, bonus, streak };
      });

      if (result.wait) {
        // Round up to whole minutes FIRST, then split into hours and minutes (59.5 min is "59 мин"... and 59.9 min is "1 ч 0 мин", never "60 мин").
        const totalMin = Math.max(1, Math.ceil(result.wait / 60000));
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
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
      const refused = await require('../../utils/memberGate').refuseTarget(interaction, target, { bots: 'Нельзя перевести боту.' });
      if (refused) return interaction.reply({ embeds: [embeds.error(refused)], flags: MessageFlags.Ephemeral });

      const guildId = interaction.guild.id;
      const settings = await getOrCreateSettings(guildId);
      const crystals = interaction.options.getString('currency') === 'crystals';
      const field = crystals ? 'crystals' : 'balance';
      const currency = crystals ? settings.crystalName : settings.currencyName;
      // The take-away ("only if enough") and the credit are two statements of ONE transaction: both happen or neither does. The server's
      // sections add their rules: the treasury's tax, the daily limit, a delay for newcomers (bot/modules/econ/pay.js).
      const who = (id, m) => ({ id, joinedTimestamp: m?.joinedTimestamp, joinedAt: m?.joinedAt }); // the newcomer rule reads when they joined
      const receiver = who(target.id, interaction.options.getMember?.('user'));
      const r = await require('../../modules/econ/pay').pay(settings, guildId, who(interaction.user.id, interaction.member), receiver, field, amount);
      if (!r.ok && r.reason === 'limit') return interaction.reply({ embeds: [embeds.error(`Лимит переводов — ${r.limit} ${currency} в сутки. Сегодня можно ещё ${r.left}.`)], flags: MessageFlags.Ephemeral });
      if (!r.ok) return interaction.reply({ embeds: [embeds.error('Недостаточно средств.')], flags: MessageFlags.Ephemeral });
      const extra = [];
      if (r.tax) extra.push({ name: 'Налог в казну', value: `${r.tax} ${currency}`, inline: true });
      if (r.held) extra.push({ name: 'Придёт', value: `<t:${Math.floor(r.releaseAt.getTime() / 1000)}:R> — получатель недавно на сервере`, inline: false });

      const embed = embeds
        .baseEmbed(embeds.COLORS.success)
        .setTitle('✓ Перевод выполнен')
        .setDescription(`<@${interaction.user.id}> → <@${target.id}>`)
        .addFields({ name: 'Сумма', value: `${amount} ${currency}`, inline: true }, ...extra);
      return interaction.reply({ embeds: [embed] });
    }
  }
};
