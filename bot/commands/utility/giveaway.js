const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { Giveaway } = require('../../../db');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { isAdmin } = require('../../utils/permissions');
const { startGiveaway, finishGiveaway, parseWinners } = require('../../modules/giveaways');

const MIN_MS = 10_000;
const MAX_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Розыгрыши призов с таймером и случайным выбором победителей')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('start').setDescription('Начать розыгрыш в этом канале')
      .addStringOption((o) => o.setName('prize').setDescription('Что разыгрываем').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('Сколько длится: 30m, 2h, 1d (до 60 дней)').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('Сколько победителей (по умолчанию 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption((o) => o.setName('role').setDescription('Участвовать смогут только обладатели этой роли')))
    .addSubcommand((s) => s.setName('end').setDescription('Закончить розыгрыш досрочно').addIntegerOption((o) => o.setName('id').setDescription('Номер розыгрыша').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Выбрать новых победителей завершённого розыгрыша').addIntegerOption((o) => o.setName('id').setDescription('Номер розыгрыша').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('list').setDescription('Идущие розыгрыши сервера')),

  async execute(interaction) {
    const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return deny('Розыгрыши работают только на сервере.');
    if (!isAdmin(interaction.member)) return deny('Розыгрыши могут проводить только администраторы сервера.');
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'start') {
      const durationMs = parseDuration(interaction.options.getString('duration', true));
      if (!durationMs || durationMs < MIN_MS || durationMs > MAX_MS) return deny('Укажите срок от 10 секунд до 60 дней, например: 30m, 2h или 1d.');
      if ((await Giveaway.count({ where: { guildId, ended: false } })) >= MAX_ACTIVE) return deny(`Одновременно можно держать не больше ${MAX_ACTIVE} розыгрышей.`);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const giveaway = await startGiveaway(interaction, {
        prize: interaction.options.getString('prize', true).trim(),
        durationMs,
        winners: interaction.options.getInteger('winners') || 1,
        roleId: interaction.options.getRole('role')?.id
      });
      return interaction.editReply({ embeds: [embeds.success(`Розыгрыш №${giveaway.id} начался и закончится через ${formatDuration(durationMs)}.`)] });
    }

    if (sub === 'list') {
      const rows = await Giveaway.findAll({ where: { guildId, ended: false }, order: [['endsAt', 'ASC']], limit: 25 });
      if (!rows.length) return interaction.reply({ embeds: [embeds.info('Сейчас розыгрышей нет. Начните новый: `/giveaway start`.')], flags: MessageFlags.Ephemeral });
      const lines = rows.map((g) => `**№${g.id}** ${g.prize} — закончится <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>, <#${g.channelId}>`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    const giveaway = await Giveaway.findOne({ where: { id: interaction.options.getInteger('id', true), guildId } });
    if (!giveaway) return deny('Розыгрыш с таким номером не найден.');
    if (sub === 'end') {
      if (giveaway.ended) return deny('Этот розыгрыш уже закончился. Выбрать новых победителей можно через `/giveaway reroll`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await finishGiveaway(interaction.client, giveaway);
      return interaction.editReply({ embeds: [embeds.success(`Розыгрыш №${giveaway.id} завершён.`)] });
    }
    // reroll
    if (!giveaway.ended) return deny('Розыгрыш ещё идёт. Сначала закончите его: `/giveaway end`.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const winners = await finishGiveaway(interaction.client, giveaway, { reroll: true });
    return interaction.editReply({ embeds: [winners?.length ? embeds.success(`Новые победители: ${winners.map((id) => `<@${id}>`).join(', ')}.`) : embeds.info('Больше нет подходящих участников.')], allowedMentions: { parse: [] } });
  }
};
