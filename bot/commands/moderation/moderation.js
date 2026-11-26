const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { Warning, ModLog, GuildSettings } = require('../../../db');
const { recordAndAnnounce, createCase, caseEmbed, LABELS } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { memberHasPermission, hierarchyError } = require('../../utils/permissions');
const { parseDuration, formatDuration, MAX_TIMEOUT } = require('../../utils/duration');
const mod = require('../../modules/moderation');

const DURATION_HELP = 'Например 30m, 2h, 1d, 1w (минуты, часы, дни, недели)';
const ephemeral = { flags: MessageFlags.Ephemeral };
// An error is shown to the moderator alone. After a (public) deferReply the placeholder is removed and the
// error comes as a private follow-up instead.
const fail = async (interaction, text) => {
  if (!interaction.deferred) return interaction.reply({ embeds: [embeds.error(text)], ...ephemeral });
  if (typeof interaction.followUp !== 'function') return interaction.editReply({ embeds: [embeds.error(text)] });
  await interaction.deleteReply?.().catch(() => {});
  return interaction.followUp({ embeds: [embeds.error(text)], ...ephemeral });
};
// The final answer: into the deferred reply when there is one.
const done = (interaction, payload) => (interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload));
// Bans longer than this are refused (a huge number would give an invalid unban date).
const MAX_BAN_MS = 5 * 365 * 24 * 3600 * 1000;

function denyPermission(interaction, permName) {
  return fail(interaction, `Для этого действия нужно право **${permName}**.`);
}

const userOpt = (desc) => (o) => o.setName('user').setDescription(desc).setRequired(true);
const reasonOpt = (o) => o.setName('reason').setDescription('Причина');
// a reason preset of the server (Наказания → Настройки): fills the reason, the length and the points when they are empty
const presetOpt = (o) => o.setName('preset').setDescription('Шаблон нарушения сервера').setAutocomplete(true);
const silentOpt = (o) => o.setName('silent').setDescription('Тихо: ответ увидите только вы, в канал ничего не уйдёт');
const optDuration = (desc) => (o) => o.setName('duration').setDescription(desc);

const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Команды модерации сервера')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((s) => s.setName('warn').setDescription('Выдать предупреждение').addUserOption(userOpt('Кому')).addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName('points').setDescription('Вес предупреждения в баллах (1–20)').setMinValue(1).setMaxValue(20)).addStringOption(presetOpt).addBooleanOption(silentOpt))
  .addSubcommand((s) => s.setName('unwarn').setDescription('Снять предупреждение по номеру (см. /mod warnings)').addIntegerOption((o) => o.setName('number').setDescription('Номер предупреждения').setRequired(true)))
  .addSubcommand((s) => s.setName('warnings').setDescription('Действующие предупреждения участника').addUserOption(userOpt('Кого проверить')))
  .addSubcommand((s) => s.setName('clearwarns').setDescription('Снять все предупреждения участника').addUserOption(userOpt('С кого снять')))
  .addSubcommand((s) =>
    s.setName('mute').setDescription('Замутить участника (тайм-аут до 28 дней)').addUserOption(userOpt('Кого замутить'))
      .addStringOption((o) => o.setName('duration').setDescription(DURATION_HELP).setRequired(true))
      .addStringOption(reasonOpt).addStringOption(presetOpt).addBooleanOption(silentOpt)
  )
  .addSubcommand((s) => s.setName('unmute').setDescription('Снять мут').addUserOption(userOpt('Кого размутить')))
  .addSubcommand((s) => s.setName('kick').setDescription('Выгнать участника').addUserOption(userOpt('Кого')).addStringOption(reasonOpt).addStringOption(presetOpt).addBooleanOption(silentOpt))
  .addSubcommand((s) =>
    s.setName('ban').setDescription('Забанить участника (навсегда или на срок)').addUserOption(userOpt('Кого'))
      .addStringOption(reasonOpt)
      .addStringOption((o) => o.setName('duration').setDescription('Срок бана. Пусто — навсегда. ' + DURATION_HELP))
      .addIntegerOption((o) => o.setName('delete_days').setDescription('Удалить сообщения за N дней (0-7)').setMinValue(0).setMaxValue(7))
      .addStringOption(presetOpt).addBooleanOption(silentOpt)
  )
  .addSubcommand((s) => s.setName('unban').setDescription('Разбанить по ID').addStringOption((o) => o.setName('id').setDescription('ID пользователя').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('clear').setDescription('Удалить последние сообщения в канале')
      .addIntegerOption((o) => o.setName('count').setDescription('Сколько сообщений (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('user').setDescription('Удалять только сообщения этого участника'))
      .addBooleanOption((o) => o.setName('bots').setDescription('Удалять только сообщения ботов'))
      .addStringOption((o) => o.setName('contains').setDescription('Удалять только сообщения, где есть этот текст').setMaxLength(100))
      .addBooleanOption((o) => o.setName('links').setDescription('Удалять только сообщения со ссылками'))
      .addBooleanOption((o) => o.setName('attachments').setDescription('Удалять только сообщения с файлами или картинками'))
  )
  .addSubcommand((s) =>
    s.setName('note').setDescription('Приватная заметка об участнике (видна в /mod history)').addUserOption(userOpt('О ком'))
      .addStringOption((o) => o.setName('text').setDescription('Текст заметки').setRequired(true))
  )
  .addSubcommand((s) => s.setName('case').setDescription('Показать дело по номеру').addIntegerOption((o) => o.setName('number').setDescription('Номер дела').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('history').setDescription('История наказаний и заметок участника').addUserOption(userOpt('Чью историю')))
  .addSubcommand((s) =>
    s.setName('reason').setDescription('Изменить причину в деле')
      .addIntegerOption((o) => o.setName('number').setDescription('Номер дела').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('text').setDescription('Новая причина').setRequired(true))
  )
  .addSubcommand((s) =>
    s.setName('slowmode').setDescription('Медленный режим в канале (0 — выключить)')
      .addIntegerOption((o) => o.setName('seconds').setDescription('Секунд между сообщениями (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption((o) => o.setName('channel').setDescription('Канал (по умолчанию — текущий)'))
  )
  .addSubcommand((s) => s.setName('lock').setDescription('Закрыть канал: участники не смогут писать').addChannelOption((o) => o.setName('channel').setDescription('Канал (по умолчанию — текущий)')).addStringOption(reasonOpt))
  .addSubcommand((s) => s.setName('unlock').setDescription('Открыть канал снова').addChannelOption((o) => o.setName('channel').setDescription('Канал (по умолчанию — текущий)')))
  // punishments by roles (bot/modules/punishments.js): longer than a timeout, quarantine, restrictions
  .addSubcommand((s) => s.setName('rolemute').setDescription('Мут ролью: дольше 28 дней или до снятия').addUserOption(userOpt('Кого'))
    .addStringOption(optDuration('Срок. Пусто — до снятия. ' + DURATION_HELP)).addStringOption(reasonOpt).addStringOption(presetOpt).addBooleanOption(silentOpt))
  .addSubcommand((s) => s.setName('unrolemute').setDescription('Снять мут ролью').addUserOption(userOpt('С кого')).addStringOption(reasonOpt))
  .addSubcommand((s) => s.setName('quarantine').setDescription('Карантин: снять роли и оставить только канал разбора').addUserOption(userOpt('Кого'))
    .addStringOption(optDuration('Срок. Пусто — до снятия. ' + DURATION_HELP)).addStringOption(reasonOpt).addStringOption(presetOpt).addBooleanOption(silentOpt))
  .addSubcommand((s) => s.setName('unquarantine').setDescription('Снять карантин и вернуть роли').addUserOption(userOpt('С кого')).addStringOption(reasonOpt))
  .addSubcommand((s) => s.setName('restrict').setDescription('Выдать ограничительную роль сервера').addUserOption(userOpt('Кому'))
    .addStringOption((o) => o.setName('kind').setDescription('Какое ограничение').setRequired(true).setAutocomplete(true))
    .addStringOption(optDuration('Срок. Пусто — до снятия. ' + DURATION_HELP)).addStringOption(reasonOpt).addBooleanOption(silentOpt))
  .addSubcommand((s) => s.setName('unrestrict').setDescription('Снять ограничительную роль').addUserOption(userOpt('С кого'))
    .addStringOption((o) => o.setName('kind').setDescription('Какое ограничение').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('casenote').setDescription('Внутренняя заметка к делу (видна модераторам)')
    .addIntegerOption((o) => o.setName('number').setDescription('Номер дела').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('text').setDescription('Текст заметки').setRequired(true).setMaxLength(900)))
  .addSubcommand((s) => s.setName('duration').setDescription('Изменить срок действующего наказания по делу')
    .addIntegerOption((o) => o.setName('number').setDescription('Номер дела').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('duration').setDescription('Новый срок от сейчас. «0» — до снятия. ' + DURATION_HELP).setRequired(true)));

const short = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);
const dateRu = (d) => new Date(d).toLocaleDateString('ru-RU');

module.exports = {
  data,

  /** The server's reason presets and restriction roles, as the moderator types. */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const settings = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
    const cfg = mod.modCfg(settings);
    const q = String(focused.value || '').toLowerCase();
    const list = focused.name === 'kind'
      ? cfg.restrictRoles.filter((r) => r.roleId).map((r) => ({ name: r.label, value: r.roleId }))
      : cfg.presets.map((p, i) => ({ name: `${p.label}${p.reason ? ` — ${p.reason}` : ''}`.slice(0, 100), value: String(i) }));
    return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 25));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });

    // Base command permission is ModerateMembers; some actions need a stronger permission.
    if (sub === 'kick' && !memberHasPermission(interaction.member, 'KickMembers')) return denyPermission(interaction, 'Выгонять участников');
    if ((sub === 'ban' || sub === 'unban') && !memberHasPermission(interaction.member, 'BanMembers')) return denyPermission(interaction, 'Банить участников');
    if (sub === 'clear' && !memberHasPermission(interaction.member, 'ManageMessages')) return denyPermission(interaction, 'Управлять сообщениями');
    if (['slowmode', 'lock', 'unlock'].includes(sub) && !memberHasPermission(interaction.member, 'ManageChannels')) return denyPermission(interaction, 'Управлять каналами');
    // The command may be opened to roles without the timeout right (server settings → Integrations): check it here too.
    if ((sub === 'mute' || sub === 'unmute') && !memberHasPermission(interaction.member, 'ModerateMembers')) return denyPermission(interaction, 'давать тайм-аут участникам');

    // A server can demand a reason for every punishment (a preset gives one).
    if (['warn', 'mute', 'kick', 'ban', 'rolemute', 'quarantine', 'restrict'].includes(sub) && settings?.modRequireReason && !interaction.options.getString('reason') && !interaction.options.getString?.('preset')) {
      return fail(interaction, 'На этом сервере для наказания нужно указать причину.');
    }
    // the server's reason presets and the quiet mode (Наказания → Настройки)
    const cfg = mod.modCfg(settings);
    const presetKey = interaction.options.getString?.('preset');
    const preset = presetKey !== null && presetKey !== undefined ? cfg.presets[Number(presetKey)] || cfg.presets.find((p) => p.label === presetKey) || null : null;
    const silent = interaction.options.getBoolean?.('silent') ?? cfg.silentDefault;
    const publicDefer = silent ? ephemeral : {};
    const reasonOf = () => (interaction.options.getString('reason') || (preset ? preset.reason || preset.label : '') || 'Без причины').slice(0, 900);
    /** The length of a punishment: the option, else the preset's, else null (until lifted / permanent). false: unreadable. */
    const durationOf = () => {
      const text = interaction.options.getString('duration');
      if (text) { if (/^0+$/.test(text.trim())) return null; return parseDuration(text) || false; }
      return preset?.minutes ? preset.minutes * 60_000 : null;
    };
    const memberOf = (user) => guild.members.fetch(user.id).catch(() => null);

    if (sub === 'warn') {
      const target = interaction.options.getUser('user');
      if (target.id === interaction.user.id) return fail(interaction, 'Нельзя выдать предупреждение самому себе.');
      if (target.bot) return fail(interaction, 'Ботам предупреждения не выдаются.');
      const member = await memberOf(target);
      const hErr = member && hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      await interaction.deferReply(publicDefer); // saving, the DM and a possible automatic punishment can take longer than 3 s
      const points = interaction.options.getInteger?.('points') || preset?.points || null;
      const { count, escalation, warning, points: total } = await mod.warnMember(guild, target, { moderatorId: interaction.user.id, reason, settings, points });
      const auto = mod.describeEscalation(escalation);
      const embed = embeds.baseEmbed(auto && !auto.ok ? embeds.COLORS.warning : embeds.COLORS.success)
        .setTitle('Предупреждение выдано')
        .setDescription(`<@${target.id}> · предупреждение **#${warning.id}**`)
        .addFields({ name: 'Причина', value: reason.slice(0, 1000) }, { name: 'Действующих предупреждений', value: String(count), inline: true });
      if (cfg.escalateBy === 'points' || (warning.points || 1) > 1) embed.addFields({ name: 'Баллы', value: `+${warning.points || 1} · всего ${total}`, inline: true });
      if (auto) embed.addFields({ name: 'Автоматическое наказание', value: auto.text.slice(0, 1000) });
      return done(interaction, { embeds: [embed], allowedMentions: { users: [target.id] } });
    }

    if (sub === 'unwarn') {
      const id = interaction.options.getInteger('number');
      const warning = await Warning.findOne({ where: { id, guildId: guild.id } });
      if (!warning || warning.revokedAt) return fail(interaction, 'Предупреждение с таким номером не найдено.');
      if (warning.userId === interaction.user.id) return fail(interaction, 'Свои предупреждения снимает другой модератор.');
      const owner = await memberOf({ id: warning.userId });
      const ownerErr = owner && hierarchyError(interaction.member, owner);
      if (ownerErr) return fail(interaction, ownerErr);
      if (!(await mod.revokeWarning(warning, { by: interaction.user.id, reason: 'Снято командой /mod unwarn', guild }))) return fail(interaction, `Предупреждение #${id} уже снято.`);
      await recordAndAnnounce(guild, { userId: warning.userId, moderatorId: interaction.user.id, action: 'unwarn', reason: `Снято предупреждение #${id}` });
      return interaction.reply({ embeds: [embeds.success(`Предупреждение #${id} снято.`)] });
    }

    if (sub === 'clearwarns') {
      const target = interaction.options.getUser('user');
      if (target.id === interaction.user.id) return fail(interaction, 'Свои предупреждения снимает другой модератор.');
      const targetMember = await memberOf(target);
      const tErr = targetMember && hierarchyError(interaction.member, targetMember);
      if (tErr) return fail(interaction, tErr);
      // kept in the history, marked as removed
      const [removed] = await Warning.update({ revokedAt: new Date(), revokedBy: interaction.user.id, revokeReason: 'Сняты все командой /mod clearwarns' }, { where: { guildId: guild.id, userId: target.id, revokedAt: null } });
      if (!removed) return interaction.reply({ embeds: [embeds.info(`У <@${target.id}> нет предупреждений.`)] });
      await recordAndAnnounce(guild, { userId: target.id, moderatorId: interaction.user.id, action: 'unwarn', reason: `Сняты все предупреждения (${removed})` });
      return interaction.reply({ embeds: [embeds.success(`С <@${target.id}> снято предупреждений: ${removed}.`)] });
    }

    if (sub === 'warnings') {
      const target = interaction.options.getUser('user');
      const warnings = await mod.activeWarnings(guild.id, target.id, settings);
      if (!warnings.length) return interaction.reply({ embeds: [embeds.info(`У <@${target.id}> нет действующих предупреждений.`)] });
      const MAX_SHOWN = 15;
      const lines = warnings.slice(0, MAX_SHOWN).map((w) => `**#${w.id}** — ${short(w.reason, 150)} (от <@${w.moderatorId}>, ${dateRu(w.createdAt)})`);
      if (warnings.length > MAX_SHOWN) lines.push(`\n…и ещё ${warnings.length - MAX_SHOWN} предупреждений (показаны последние ${MAX_SHOWN}).`);
      const days = Number(settings?.modWarnExpireDays) || 0;
      if (days > 0) lines.push(`\n*Предупреждения сгорают через ${days} дн.*`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(`Предупреждения ${target.username} (${warnings.length})`)] });
    }

    if (sub === 'mute') {
      const target = interaction.options.getUser('user');
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms) return fail(interaction, `Не понял срок. ${DURATION_HELP}.`);
      if (ms > MAX_TIMEOUT) return fail(interaction, 'Мут не может быть дольше 28 дней (ограничение Discord).');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const botErr = mod.whyCannot(guild, member, 'mute');
      if (botErr) return fail(interaction, botErr);
      const reason = reasonOf();
      await interaction.deferReply(publicDefer);
      try {
        await mod.muteMember(guild, member, ms, { moderatorId: interaction.user.id, reason, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return done(interaction, { embeds: [embeds.success(`<@${target.id}> замучен(а) на ${formatDuration(ms)}: ${reason}`)] });
    }

    if (sub === 'unmute') {
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp < Date.now()) return fail(interaction, 'У этого участника нет мута.');
      const botErr = mod.whyCannot(guild, member, 'unmute');
      if (botErr) return fail(interaction, botErr);
      await interaction.deferReply();
      try {
        await member.timeout(null);
      } catch (err) {
        return fail(interaction, require('../../utils/punishable').apiErrorText(err, 'unmute'));
      }
      await recordAndAnnounce(guild, { userId: target.id, moderatorId: interaction.user.id, action: 'unmute' });
      return done(interaction, { embeds: [embeds.success(`<@${target.id}> размучен(а).`)] });
    }

    if (sub === 'kick') {
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      await interaction.deferReply(publicDefer);
      try {
        await mod.kickMember(guild, member, { moderatorId: interaction.user.id, reason, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return done(interaction, { embeds: [embeds.success(`<@${target.id}> кикнут(а): ${reason}`)] });
    }

    if (sub === 'ban') {
      const target = interaction.options.getUser('user');
      const ms = durationOf();
      if (ms === false) return fail(interaction, `Не понял срок. ${DURATION_HELP}.`);
      if (ms && ms > MAX_BAN_MS) return fail(interaction, 'Временный бан — не дольше 5 лет. Для бессрочного не указывайте срок.');
      if (target.id === interaction.user.id) return fail(interaction, 'Нельзя забанить самого себя.');
      const member = await memberOf(target);
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      const deleteDays = interaction.options.getInteger('delete_days') || 0;
      await interaction.deferReply(publicDefer);
      try {
        await mod.banUser(guild, target.id, { moderatorId: interaction.user.id, reason, ms, deleteSeconds: deleteDays * 86400, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return done(interaction, { embeds: [embeds.success(`<@${target.id}> забанен(а) ${ms ? `на ${formatDuration(ms)}` : 'навсегда'}: ${reason}`)] });
    }

    if (sub === 'unban') {
      const userId = interaction.options.getString('id').trim();
      if (!/^\d{15,25}$/.test(userId)) return fail(interaction, 'ID должен состоять только из цифр (15–25 знаков).');
      try {
        await mod.unbanUser(guild, userId, { moderatorId: interaction.user.id });
      } catch {
        return fail(interaction, 'Не удалось разбанить: пользователь не найден в бан-листе.');
      }
      return interaction.reply({ embeds: [embeds.success(`Пользователь <@${userId}> разбанен.`)] });
    }

    if (sub === 'clear') {
      const amount = interaction.options.getInteger('count');
      const only = interaction.options.getUser('user');
      await interaction.deferReply(ephemeral);
      const text = (interaction.options.getString('contains') || '').toLowerCase();
      const onlyBots = interaction.options.getBoolean('bots');
      const onlyLinks = interaction.options.getBoolean('links');
      const onlyFiles = interaction.options.getBoolean('attachments');
      const filtered = Boolean(only || text || onlyBots || onlyLinks || onlyFiles);
      let deleted = null;
      if (filtered) {
        // Bulk delete takes the last 100 messages; keep those that match every filter.
        const fetched = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
        const matches = (m) => (!only || m.author?.id === only.id)
          && (!onlyBots || m.author?.bot)
          && (!text || String(m.content || '').toLowerCase().includes(text))
          && (!onlyLinks || /https?:\/\/|discord\.gg\//i.test(m.content || ''))
          && (!onlyFiles || (m.attachments?.size || 0) > 0);
        const mine = fetched ? [...fetched.values()].filter(matches).slice(0, amount) : [];
        deleted = mine.length ? await interaction.channel.bulkDelete(mine, true).catch(() => null) : { size: 0 };
      } else {
        deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
      }
      if (!deleted) return interaction.editReply({ embeds: [embeds.error('Не удалось удалить сообщения (возможно, они старше 14 дней или у бота нет права «Управлять сообщениями»).')] });
      await recordAndAnnounce(guild, {
        userId: only?.id || interaction.user.id,
        moderatorId: interaction.user.id,
        action: 'clear',
        reason: `Удалено ${deleted.size} сообщений в #${interaction.channel.name}${only ? ` (только <@${only.id}>)` : ''}${onlyBots ? ' (только боты)' : ''}${onlyLinks ? ' (только со ссылками)' : ''}${onlyFiles ? ' (только с файлами)' : ''}${text ? ` (с текстом «${text.slice(0, 40)}»)` : ''}`
      });
      return interaction.editReply({ embeds: [embeds.success(`Удалено ${deleted.size} сообщений.`)] });
    }

    if (sub === 'note') {
      const target = interaction.options.getUser('user');
      const text = interaction.options.getString('text').slice(0, 900);
      const entry = await createCase(guild.id, { userId: target.id, moderatorId: interaction.user.id, action: 'note', reason: text });
      return interaction.reply({ embeds: [embeds.success(`Заметка о <@${target.id}> сохранена (дело #${entry.caseNumber}).`)], ...ephemeral });
    }

    if (sub === 'case') {
      const entry = await ModLog.findOne({ where: { guildId: guild.id, caseNumber: interaction.options.getInteger('number') } });
      if (!entry) return fail(interaction, 'Дело с таким номером не найдено.');
      const embed = caseEmbed(entry).addFields({ name: 'Дата', value: new Date(entry.createdAt).toLocaleString('ru-RU'), inline: true });
      if (entry.active && entry.expiresAt) embed.addFields({ name: 'Разбан', value: `<t:${Math.floor(new Date(entry.expiresAt).getTime() / 1000)}:R>`, inline: true });
      return interaction.reply({ embeds: [embed], ...ephemeral });
    }

    if (sub === 'history') {
      const target = interaction.options.getUser('user');
      const rows = await ModLog.findAll({ where: { guildId: guild.id, userId: target.id }, order: [['createdAt', 'DESC']], limit: 15 });
      if (!rows.length) return interaction.reply({ embeds: [embeds.info(`В истории <@${target.id}> пусто.`)], ...ephemeral });
      const lines = rows.map((r) => `**#${r.caseNumber ?? '—'}** ${LABELS[r.action] || r.action}${r.duration ? ` (${formatDuration(Number(r.duration))})` : ''} — ${short(r.reason || '—', 120)} · ${dateRu(r.createdAt)}`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(`История ${target.username}`)], ...ephemeral });
    }

    if (sub === 'reason') {
      const number = interaction.options.getInteger('number');
      const entry = await ModLog.findOne({ where: { guildId: guild.id, caseNumber: number } });
      if (!entry) return fail(interaction, 'Дело с таким номером не найдено.');
      // Nobody rewrites the case about himself, and the old wording does not vanish: it stays in the bot's log.
      if (entry.userId === interaction.user.id && !memberHasPermission(interaction.member, 'Administrator')) return fail(interaction, 'Причину в деле о себе изменить нельзя.');
      logger.info(`Case #${number} in ${guild.id}: reason changed by ${interaction.user.id}; was: ${String(entry.reason || '').slice(0, 300)}`);
      await require('../../../db').CaseNote.create({ guildId: guild.id, caseNumber: number, authorId: interaction.user.id, kind: 'reason', text: `Причина изменена. Было: ${String(entry.reason || '—').slice(0, 900)}` }).catch(() => {});
      await entry.update({ reason: interaction.options.getString('text').slice(0, 900) });
      return interaction.reply({ embeds: [embeds.success(`Причина в деле #${number} изменена.`)], ...ephemeral });
    }

    if (sub === 'rolemute' || sub === 'quarantine' || sub === 'restrict') {
      if (!memberHasPermission(interaction.member, 'ManageRoles')) return denyPermission(interaction, 'Управлять ролями');
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const ms = durationOf();
      if (ms === false) return fail(interaction, `Не понял срок. ${DURATION_HELP}.`);
      const kind = sub === 'rolemute' ? 'role_mute' : sub;
      const roleId = sub === 'restrict' ? interaction.options.getString('kind') : null;
      const reason = reasonOf();
      await interaction.deferReply(publicDefer);
      let r;
      try { r = await require('../../modules/punishments').apply(guild, member, kind, { roleId, ms, moderatorId: interaction.user.id, reason, settings }); } catch (err) { return fail(interaction, err.message); }
      const what = { role_mute: 'получил(а) мут ролью', quarantine: 'отправлен(а) в карантин', restrict: `получил(а) ограничение «${(cfg.restrictRoles.find((x) => x.roleId === roleId) || {}).label || ''}»` }[kind];
      const lines = [`<@${target.id}> ${what} ${ms ? `на ${formatDuration(ms)}` : 'до снятия'}: ${reason}. Дело #${r.entry.caseNumber}.`];
      if (r.skipped.length) lines.push(`Не сняты (выше роли бота): ${r.skipped.map((id) => `<@&${id}>`).join(', ')}.`);
      return done(interaction, { embeds: [embeds.success(lines.join('\n'))], allowedMentions: { parse: [] } });
    }

    if (sub === 'unrolemute' || sub === 'unquarantine' || sub === 'unrestrict') {
      if (!memberHasPermission(interaction.member, 'ManageRoles')) return denyPermission(interaction, 'Управлять ролями');
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      const hErr = member && hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const kind = { unrolemute: 'role_mute', unquarantine: 'quarantine', unrestrict: 'restrict' }[sub];
      const where = { guildId: guild.id, userId: target.id, kind, active: true };
      if (kind === 'restrict') where.roleId = interaction.options.getString('kind');
      const row = await require('../../../db').RolePunishment.findOne({ where, order: [['id', 'DESC']] });
      if (!row) return fail(interaction, 'У участника нет такого действующего наказания.');
      await interaction.deferReply();
      let r;
      try { r = await require('../../modules/punishments').lift(guild, row, { by: interaction.user.id, reason: interaction.options.getString('reason') || 'Снято модератором' }); } catch (err) { return fail(interaction, err.message); }
      const extra = kind === 'quarantine' && r.ok ? ` Возвращено ролей: ${r.given.length}${r.skipped.length ? `, не удалось: ${r.skipped.length}` : ''}.` : '';
      return done(interaction, { embeds: [embeds.success(`Снято с <@${target.id}>.${extra}`)], allowedMentions: { parse: [] } });
    }

    if (sub === 'casenote') {
      const number = interaction.options.getInteger('number');
      const entry = await ModLog.findOne({ where: { guildId: guild.id, caseNumber: number } });
      if (!entry) return fail(interaction, 'Дело с таким номером не найдено.');
      await require('../../../db').CaseNote.create({ guildId: guild.id, caseNumber: number, authorId: interaction.user.id, kind: 'note', text: interaction.options.getString('text').slice(0, 900) });
      return interaction.reply({ embeds: [embeds.success(`Заметка добавлена к делу #${number}.`)], ...ephemeral });
    }

    if (sub === 'duration') {
      const number = interaction.options.getInteger('number');
      const text = interaction.options.getString('duration').trim();
      const ms = /^0+$/.test(text) ? null : (parseDuration(text) || false);
      if (ms === false) return fail(interaction, `Не понял срок. ${DURATION_HELP}.`);
      const { RolePunishment, TempRole } = require('../../../db');
      const row = await RolePunishment.findOne({ where: { guildId: guild.id, caseNumber: number, active: true } });
      if (row) {
        const target = await memberOf({ id: row.userId });
        const hErr = target && hierarchyError(interaction.member, target);
        if (hErr) return fail(interaction, hErr);
        await row.update({ expiresAt: null });
        const until = await require('../../modules/punishments').extend(row, ms, interaction.user.id);
        return interaction.reply({ embeds: [embeds.success(`Срок по делу #${number}: ${until ? `до <t:${Math.floor(until.getTime() / 1000)}:f>` : 'до снятия'}.`)], ...ephemeral });
      }
      const ban = await ModLog.findOne({ where: { guildId: guild.id, caseNumber: number, action: 'ban', active: true } });
      if (ban) {
        if (!memberHasPermission(interaction.member, 'BanMembers')) return denyPermission(interaction, 'Банить участников');
        const was = ban.expiresAt;
        await ban.update({ expiresAt: ms ? new Date(Date.now() + ms) : null, duration: ms, active: Boolean(ms) });
        if (!ms) await ban.update({ active: false }); // permanent now: nothing to lift
        require('../../utils/scheduler').poke('mod');
        await require('../../../db').CaseNote.create({ guildId: guild.id, caseNumber: number, authorId: interaction.user.id, kind: 'duration', text: `Срок бана изменён: ${was ? new Date(was).toISOString().slice(0, 16).replace('T', ' ') : 'навсегда'} → ${ms ? new Date(Date.now() + ms).toISOString().slice(0, 16).replace('T', ' ') : 'навсегда'} (UTC)` });
        return interaction.reply({ embeds: [embeds.success(`Срок бана по делу #${number}: ${ms ? `до <t:${Math.floor((Date.now() + ms) / 1000)}:f>` : 'навсегда'}.`)], ...ephemeral });
      }
      const tr = await TempRole.findOne({ where: { guildId: guild.id, caseNumber: number } });
      if (tr && ms) {
        await tr.update({ expiresAt: new Date() });
        const until = await require('../../modules/tempRoles').extendWithCase(tr, ms, interaction.user.id);
        return interaction.reply({ embeds: [embeds.success(`Временная роль по делу #${number}: до <t:${Math.floor(until.getTime() / 1000)}:f>.`)], ...ephemeral });
      }
      return fail(interaction, 'По этому делу нет действующего наказания со сроком (мут ролью, карантин, ограничение, временный бан или роль).');
    }

    if (sub === 'slowmode') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const seconds = interaction.options.getInteger('seconds');
      if (typeof channel.setRateLimitPerUser !== 'function') return fail(interaction, 'В этом канале нельзя включить медленный режим.');
      try {
        await channel.setRateLimitPerUser(seconds, `Медленный режим от ${interaction.user.tag ?? interaction.user.username}`);
      } catch {
        return fail(interaction, 'Не удалось изменить медленный режим (нужно право «Управлять каналами»).');
      }
      return interaction.reply({ embeds: [embeds.success(seconds ? `В <#${channel.id}> включён медленный режим: ${seconds} с.` : `Медленный режим в <#${channel.id}> выключен.`)] });
    }

    if (sub === 'lock' || sub === 'unlock') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const locking = sub === 'lock';
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locking ? false : null }, { reason: locking ? reasonOf() : 'Канал открыт' });
      } catch {
        return fail(interaction, 'Не удалось изменить права канала (нужно право «Управлять каналами»).');
      }
      return interaction.reply({ embeds: [embeds.success(locking ? `🔒 <#${channel.id}> закрыт: участники не могут писать. Открыть: \`/mod unlock\`.` : `🔓 <#${channel.id}> открыт.`)] });
    }
  }
};
