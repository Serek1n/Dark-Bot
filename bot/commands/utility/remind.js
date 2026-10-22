const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { Reminder } = require('../../../db');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { MAX_PENDING, MIN_MS, MAX_MS } = require('../../modules/reminders');

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Напоминания: бот упомянет вас через заданное время')
    .addSubcommand((s) => s.setName('add').setDescription('Напомнить через некоторое время')
      .addStringOption((o) => o.setName('time').setDescription('Через сколько: 10m, 2h, 1d, 1w').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('О чём напомнить').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('list').setDescription('Ваши ожидающие напоминания'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Отменить напоминание').addIntegerOption((o) => o.setName('id').setDescription('Номер из списка').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'add') {
      const ms = parseDuration(interaction.options.getString('time', true));
      if (!ms || ms < MIN_MS || ms > MAX_MS) return reply(embeds.error('Укажите срок от 10 секунд до года, например: 30m, 2h, 1d.'));
      if ((await Reminder.count({ where: { userId } })) >= MAX_PENDING) return reply(embeds.error(`У вас уже ${MAX_PENDING} напоминаний. Отмените ненужные: \`/remind cancel\`.`));
      const text = interaction.options.getString('text', true).trim().replace(/@(everyone|here)/g, '@​$1');
      const row = await Reminder.create({ userId, guildId: interaction.guild?.id || null, channelId: interaction.channelId || null, text, remindAt: new Date(Date.now() + ms) });
      require('../../utils/scheduler').poke('reminders');
      return reply(embeds.success(`Напомню через ${formatDuration(ms)} (<t:${unix(row.remindAt)}:f>). Номер напоминания: ${row.id}.`));
    }

    if (sub === 'list') {
      const rows = await Reminder.findAll({ where: { userId }, order: [['remindAt', 'ASC']], limit: MAX_PENDING });
      if (!rows.length) return reply(embeds.info('У вас нет напоминаний. Создайте: `/remind add`.'));
      return reply(embeds.info(rows.map((r) => `**№${r.id}** <t:${unix(r.remindAt)}:R> — ${r.text.slice(0, 120)}`).join('\n')));
    }

    const removed = await Reminder.destroy({ where: { id: interaction.options.getInteger('id', true), userId } });
    return reply(removed ? embeds.success('Напоминание отменено.') : embeds.error('У вас нет напоминания с таким номером.'));
  }
};
