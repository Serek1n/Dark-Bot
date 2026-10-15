const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { Warning, ModLog, GuildSettings } = require('../../../db');
const { recordAndAnnounce, createCase, caseEmbed, LABELS } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');
const { memberHasPermission, hierarchyError } = require('../../utils/permissions');
const { parseDuration, formatDuration, MAX_TIMEOUT } = require('../../utils/duration');
const mod = require('../../modules/moderation');

const DURATION_HELP = 'Например 30m, 2h, 1d, 1w (минуты, часы, дни, недели)';
const ephemeral = { flags: MessageFlags.Ephemeral };
const fail = (interaction, text) => interaction.reply({ embeds: [embeds.error(text)], ...ephemeral });

function denyPermission(interaction, permName) {
  return fail(interaction, `Для этого действия нужно право **${permName}**.`);
}

const userOpt = (desc) => (o) => o.setName('user').setDescription(desc).setRequired(true);
const reasonOpt = (o) => o.setName('reason').setDescription('Причина');

const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Команды модерации сервера')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((s) => s.setName('warn').setDescription('Выдать предупреждение').addUserOption(userOpt('Кому')).addStringOption(reasonOpt))
  .addSubcommand((s) => s.setName('unwarn').setDescription('Снять предупреждение по номеру (см. /mod warnings)').addIntegerOption((o) => o.setName('number').setDescription('Номер предупреждения').setRequired(true)))
  .addSubcommand((s) => s.setName('warnings').setDescription('Действующие предупреждения участника').addUserOption(userOpt('Кого проверить')))
  .addSubcommand((s) => s.setName('clearwarns').setDescription('Снять все предупреждения участника').addUserOption(userOpt('С кого снять')))
  .addSubcommand((s) =>
    s.setName('mute').setDescription('Замутить участника (тайм-аут до 28 дней)').addUserOption(userOpt('Кого замутить'))
      .addStringOption((o) => o.setName('duration').setDescription(DURATION_HELP).setRequired(true))
      .addStringOption(reasonOpt)
  )
  .addSubcommand((s) => s.setName('unmute').setDescription('Снять мут').addUserOption(userOpt('Кого размутить')))
  .addSubcommand((s) => s.setName('kick').setDescription('Выгнать участника').addUserOption(userOpt('Кого')).addStringOption(reasonOpt))
  .addSubcommand((s) =>
    s.setName('ban').setDescription('Забанить участника (навсегда или на срок)').addUserOption(userOpt('Кого'))
      .addStringOption(reasonOpt)
      .addStringOption((o) => o.setName('duration').setDescription('Срок бана. Пусто — навсегда. ' + DURATION_HELP))
      .addIntegerOption((o) => o.setName('delete_days').setDescription('Удалить сообщения за N дней (0-7)').setMinValue(0).setMaxValue(7))
  )
  .addSubcommand((s) => s.setName('unban').setDescription('Разбанить по ID').addStringOption((o) => o.setName('id').setDescription('ID пользователя').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('clear').setDescription('Удалить последние сообщения в канале')
      .addIntegerOption((o) => o.setName('count').setDescription('Сколько сообщений (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('user').setDescription('Удалять только сообщения этого участника'))
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
  .addSubcommand((s) => s.setName('unlock').setDescription('Открыть канал снова').addChannelOption((o) => o.setName('channel').setDescription('Канал (по умолчанию — текущий)')));

const short = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);
const dateRu = (d) => new Date(d).toLocaleDateString('ru-RU');

module.exports = {
  data,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });

    // Base command permission is ModerateMembers; some actions need a stronger permission.
    if (sub === 'kick' && !memberHasPermission(interaction.member, 'KickMembers')) return denyPermission(interaction, 'Kick Members');
    if ((sub === 'ban' || sub === 'unban') && !memberHasPermission(interaction.member, 'BanMembers')) return denyPermission(interaction, 'Ban Members');
    if (sub === 'clear' && !memberHasPermission(interaction.member, 'ManageMessages')) return denyPermission(interaction, 'Manage Messages');
    if (['slowmode', 'lock', 'unlock'].includes(sub) && !memberHasPermission(interaction.member, 'ManageChannels')) return denyPermission(interaction, 'Manage Channels');

    // A server can demand a reason for every punishment.
    if (['warn', 'mute', 'kick', 'ban'].includes(sub) && settings?.modRequireReason && !interaction.options.getString('reason')) {
      return fail(interaction, 'На этом сервере для наказания нужно указать причину.');
    }
    const reasonOf = () => (interaction.options.getString('reason') || 'Без причины').slice(0, 900);
    const memberOf = (user) => guild.members.fetch(user.id).catch(() => null);

    if (sub === 'warn') {
      const target = interaction.options.getUser('user');
      if (target.id === interaction.user.id) return fail(interaction, 'Нельзя выдать предупреждение самому себе.');
      if (target.bot) return fail(interaction, 'Ботам предупреждения не выдаются.');
      const member = await memberOf(target);
      const hErr = member && hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      const { count, escalation } = await mod.warnMember(guild, target, { moderatorId: interaction.user.id, reason, settings });
      let text = `<@${target.id}> получил(а) предупреждение (${count}): ${reason}`;
      if (escalation) {
        const what = { mute: `мут на ${escalation.ms ? formatDuration(escalation.ms) : ''}`, kick: 'кик', ban: escalation.ms ? `бан на ${formatDuration(escalation.ms)}` : 'бан' }[escalation.action];
        text += escalation.error ? `\n⚠️ Автоматическое наказание (${what}) не удалось: ${escalation.error}` : `\n🔔 Автоматически: ${what}`;
      }
      return interaction.reply({ embeds: [embeds.success(text)] });
    }

    if (sub === 'unwarn') {
      const id = interaction.options.getInteger('number');
      const warning = await Warning.findOne({ where: { id, guildId: guild.id } });
      if (!warning) return fail(interaction, 'Предупреждение с таким номером не найдено.');
      await warning.destroy();
      await recordAndAnnounce(guild, { userId: warning.userId, moderatorId: interaction.user.id, action: 'unwarn', reason: `Снято предупреждение #${id}` });
      return interaction.reply({ embeds: [embeds.success(`Предупреждение #${id} снято.`)] });
    }

    if (sub === 'clearwarns') {
      const target = interaction.options.getUser('user');
      const removed = await Warning.destroy({ where: { guildId: guild.id, userId: target.id } });
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
      const reason = reasonOf();
      try {
        await mod.muteMember(guild, member, ms, { moderatorId: interaction.user.id, reason, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> замучен(а) на ${formatDuration(ms)}: ${reason}`)] });
    }

    if (sub === 'unmute') {
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      await member.timeout(null);
      await recordAndAnnounce(guild, { userId: target.id, moderatorId: interaction.user.id, action: 'unmute' });
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> размучен(а).`)] });
    }

    if (sub === 'kick') {
      const target = interaction.options.getUser('user');
      const member = await memberOf(target);
      if (!member) return fail(interaction, 'Участник не найден.');
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      try {
        await mod.kickMember(guild, member, { moderatorId: interaction.user.id, reason, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> кикнут(а): ${reason}`)] });
    }

    if (sub === 'ban') {
      const target = interaction.options.getUser('user');
      const durationText = interaction.options.getString('duration');
      const ms = durationText ? parseDuration(durationText) : null;
      if (durationText && !ms) return fail(interaction, `Не понял срок. ${DURATION_HELP}.`);
      if (target.id === interaction.user.id) return fail(interaction, 'Нельзя забанить самого себя.');
      const member = await memberOf(target);
      const hErr = hierarchyError(interaction.member, member);
      if (hErr) return fail(interaction, hErr);
      const reason = reasonOf();
      const deleteDays = interaction.options.getInteger('delete_days') || 0;
      try {
        await mod.banUser(guild, target.id, { moderatorId: interaction.user.id, reason, ms, deleteSeconds: deleteDays * 86400, settings });
      } catch (err) {
        return fail(interaction, err.message);
      }
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> забанен(а) ${ms ? `на ${formatDuration(ms)}` : 'навсегда'}: ${reason}`)] });
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
      let deleted = null;
      if (only) {
        // Bulk delete takes the last 100 messages and keeps only this member's.
        const fetched = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
        const mine = fetched ? [...fetched.values()].filter((m) => m.author?.id === only.id).slice(0, amount) : [];
        deleted = mine.length ? await interaction.channel.bulkDelete(mine, true).catch(() => null) : { size: 0 };
      } else {
        deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
      }
      if (!deleted) return interaction.editReply({ embeds: [embeds.error('Не удалось удалить сообщения (возможно, они старше 14 дней или у бота нет права «Управлять сообщениями»).')] });
      await recordAndAnnounce(guild, {
        userId: only?.id || interaction.user.id,
        moderatorId: interaction.user.id,
        action: 'clear',
        reason: `Удалено ${deleted.size} сообщений в #${interaction.channel.name}${only ? ` (только <@${only.id}>)` : ''}`
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
      await entry.update({ reason: interaction.options.getString('text').slice(0, 900) });
      return interaction.reply({ embeds: [embeds.success(`Причина в деле #${number} изменена.`)], ...ephemeral });
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
