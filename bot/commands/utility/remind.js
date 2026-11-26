const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { Reminder } = require('../../../db');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { MAX_PENDING, MIN_MS, MAX_MS } = require('../../modules/reminders');
const mc = require('../../utils/moduleConfig');

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

/**
 * «через сколько» (10m, 2h, 1d) or a clock time in the server's zone: «18:30» (today, or tomorrow when it has passed),
 * «25.12 18:30», «25.12.2026 18:30». Returns the time in ms from now, or null.
 */
function whenOf(text, tz, now = Date.now()) {
  const s = String(text || '').trim();
  const sched = require('../../modules/scheduledMessages');
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) {
    const w = sched.wallClock(now, tz);
    let at = sched.zonedToUtc(w.y, w.m, w.d, +m[1], +m[2], tz);
    if (at <= now) at = sched.zonedToUtc(w.y, w.m, w.d + 1, +m[1], +m[2], tz);
    return +m[1] < 24 && +m[2] < 60 ? at - now : null;
  }
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) {
    const w = sched.wallClock(now, tz);
    const at = sched.zonedToUtc(m[3] ? +m[3] : w.y, +m[2], +m[1], +m[4], +m[5], tz);
    return at - now;
  }
  return parseDuration(s);
}

/** The limits of the server («Напоминания» in the panel), within the bot's own. */
function limitsOf(cfg) {
  return { max: Math.min(cfg.maxPerUser, MAX_PENDING * 2), minMs: Math.max(MIN_MS, cfg.minMinutes * 60_000), maxMs: Math.min(MAX_MS, cfg.maxDays * 24 * 3600_000) };
}

/** Pings that may not go out through a reminder: @everyone, @here and roles; the text keeps them as plain words. */
const stripMentions = (t) => String(t).replace(/@(everyone|here)/g, '@​$1').replace(/<@&(\d+)>/g, '@роль');

module.exports = {
  whenOf, limitsOf, stripMentions,
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Напоминания: бот упомянет вас через заданное время')
    .addSubcommand((s) => s.setName('add').setDescription('Напомнить через некоторое время или в заданное время')
      .addStringOption((o) => o.setName('time').setDescription('Через сколько: 10m, 2h, 1d — или когда: 18:30, 25.12 18:30').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('О чём напомнить').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('list').setDescription('Ваши ожидающие напоминания'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Отменить напоминание').addIntegerOption((o) => o.setName('id').setDescription('Номер из списка').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const settings = interaction.guild ? await require('../../modules/leveling').getOrCreateSettings(interaction.guild.id) : null;
    const cfg = mc.read(settings, 'reminders');
    const lim = limitsOf(cfg);
    const tz = require('../../../shared/zones').zoneOf(settings);

    if (sub === 'add') {
      const ms = whenOf(interaction.options.getString('time', true), tz);
      if (!ms || ms < lim.minMs || ms > lim.maxMs) return reply(embeds.error(`Укажите срок от ${formatDuration(lim.minMs)} до ${formatDuration(lim.maxMs)}: например, 30m, 2h, 1d или время 18:30.`));
      if ((await Reminder.count({ where: { userId } })) >= lim.max) return reply(embeds.error(`У вас уже ${lim.max} напоминаний — это предел. Отмените ненужные: \`/remind cancel\`.`));
      let text = interaction.options.getString('text', true).trim();
      text = cfg.stripMentions ? stripMentions(text) : text.replace(/@(everyone|here)/g, '@​$1');
      // The reminder is posted later in this channel: only if the person may write here himself and the server allows
      // reminders in channels; otherwise it comes to DMs (a read-only channel like #news must not get someone's text).
      const canWrite = !cfg.dmOnly && Boolean(interaction.channel?.permissionsFor?.(interaction.user)?.has?.(['ViewChannel', 'SendMessages']));
      const row = await Reminder.create({ userId, guildId: interaction.guild?.id || null, channelId: canWrite ? interaction.channelId : null, text, remindAt: new Date(Date.now() + ms) });
      require('../../utils/scheduler').poke('reminders');
      return reply(embeds.success(`Напомню через ${formatDuration(ms)} (<t:${unix(row.remindAt)}:f>)${canWrite ? '' : ' в личные сообщения'}. Номер напоминания: ${row.id}.`));
    }

    if (sub === 'list') {
      const rows = await Reminder.findAll({ where: { userId }, order: [['remindAt', 'ASC']], limit: 50 });
      if (!rows.length) return reply(embeds.info('У вас нет напоминаний. Создайте: `/remind add`.'));
      return reply(embeds.info(rows.map((r) => `**№${r.id}** <t:${unix(r.remindAt)}:R> — ${r.text.slice(0, 120)}`).join('\n')));
    }

    const removed = await Reminder.destroy({ where: { id: interaction.options.getInteger('id', true), userId } });
    return reply(removed ? embeds.success('Напоминание отменено.') : embeds.error('У вас нет напоминания с таким номером.'));
  }
};
