const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { QueryTypes } = require('sequelize');
const crypto = require('crypto');
const { sequelize } = require('../../../db');
const { getOrCreateProfile, getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');
const config = require('../../modules/econ/config');
const ledger = require('../../modules/econ/ledger');

// A shift: a random job, pay between the server's min and max plus a little for every level. No gambling: you always get paid.
const JOBS = [
  ['Курьер', 'доставил пиццу на другой конец города'], ['Бариста', 'сварил сотню капучино'], ['Программист', 'починил баг прямо в продакшене'],
  ['Дизайнер', 'нарисовал логотип с третьей попытки'], ['Модератор', 'разобрал очередь жалоб'], ['Стример', 'провёл стрим до самого утра'],
  ['Садовник', 'подстриг кусты в форме дракона'], ['Механик', 'перебрал двигатель старой «копейки»'], ['Переводчик', 'перевёл инструкцию к холодильнику'],
  ['Повар', 'приготовил ужин на двадцать гостей'], ['Библиотекарь', 'расставил книги по цвету обложек'], ['Таксист', 'довёз пассажира быстрее навигатора']
];

module.exports = {
  data: new SlashCommandBuilder().setName('work').setDescription('Выйти на смену и заработать монеты'),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const settings = await getOrCreateSettings(guildId);
    if (!config.isOn(settings, 'work')) return interaction.reply({ embeds: [embeds.info('Работа на этом сервере выключена. Администратор может включить её в панели: Экономика.')], flags: MessageFlags.Ephemeral });
    const p = config.params(settings, 'work');
    const profile = await getOrCreateProfile(guildId, userId);
    const cooldown = p.cooldownMin * 60000;
    const last = profile.lastWorkAt ? new Date(profile.lastWorkAt).getTime() : 0;
    const wait = last + cooldown - Date.now();
    if (wait > 0) {
      const min = Math.ceil(wait / 60000);
      return interaction.reply({ embeds: [embeds.error(`Смена ещё не закончилась. Следующая через ${min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`}.`)], flags: MessageFlags.Ephemeral });
    }
    const base = p.min + crypto.randomInt(p.max - p.min + 1);
    const pay = Math.round((base + p.perLevel * (Number(profile.level) || 0)) * require('../../modules/econ/bank').rateOf(settings));
    const now = new Date();
    // paid only if the previous shift is still older than the cooldown: two clicks at once can't both be paid
    const rows = await sequelize.query(`UPDATE member_profiles SET balance = balance + ?, lastWorkAt = ?, updatedAt = ?
      WHERE guildId = ? AND userId = ? AND (lastWorkAt IS NULL OR lastWorkAt <= ?) RETURNING balance`,
    { replacements: [pay, now, now, guildId, userId, new Date(now.getTime() - cooldown)], type: QueryTypes.SELECT });
    if (!rows.length) return interaction.reply({ embeds: [embeds.error('Смена ещё не закончилась.')], flags: MessageFlags.Ephemeral });
    const [job, story] = JOBS[crypto.randomInt(JOBS.length)];
    await ledger.record({ guildId, userId, amount: pay, kind: 'work', note: job }).catch(() => {});
    const embed = embeds.baseEmbed(embeds.COLORS.success).setTitle(`${job}: смена окончена`)
      .setDescription(`Вы ${story} и заработали **${pay} ${settings.currencyName}**.`)
      .addFields({ name: 'Баланс', value: `${rows[0].balance} ${settings.currencyName}`, inline: true }, { name: 'Следующая смена', value: `<t:${Math.floor((now.getTime() + cooldown) / 1000)}:R>`, inline: true });
    return interaction.reply({ embeds: [embed] });
  }
};
