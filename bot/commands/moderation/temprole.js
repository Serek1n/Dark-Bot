// /temprole — a role for a while, as a case: give (with the reason and an optional DM), remove before its end, extend,
// list (of a member, or of the whole server). The scheduler takes the role away at its end (bot/modules/tempRoles.js).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const tempRoles = require('../../modules/tempRoles');
const { TempRole } = require('../../../db');
const { hierarchyError } = require('../../utils/permissions');

const MAX_MS = 366 * 24 * 3600 * 1000;
const { DANGEROUS } = require('../../utils/safeRole'); // one list for the panel and the commands
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

/** Why this moderator may not give or take this role, or null. */
function roleRefusal(guild, me, role) {
  if (role.managed || role.id === guild.id) return 'Эту роль выдать нельзя: ею управляет Discord или интеграция.';
  const isOwner = guild.ownerId === me.id;
  if (!isOwner && role.position >= (me.roles?.highest?.position ?? 0)) return 'Роль должна быть ниже вашей высшей роли.';
  if (!isOwner && !me.permissions.has(PermissionFlagsBits.Administrator) && (BigInt(role.permissions?.bitfield ?? 0n) & DANGEROUS) !== 0n) return 'Роли с правами модерации выдаёт только администратор.';
  if (role.editable === false) return 'Бот не может выдать эту роль: его роль должна быть выше.';
  return null;
}

module.exports = {
  roleRefusal,
  data: new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Роли на время: выдать, снять, продлить, список')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('give').setDescription('Выдать роль на время')
      .addUserOption((o) => o.setName('user').setDescription('Кому').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Какую роль').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('На сколько: 30m, 2h, 7d, 0.5h, 1y').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Причина (попадёт в дело)').setMaxLength(500))
      .addBooleanOption((o) => o.setName('dm').setDescription('Написать участнику в личные сообщения')))
    .addSubcommand((s) => s.setName('remove').setDescription('Снять временную роль раньше срока')
      .addUserOption((o) => o.setName('user').setDescription('С кого').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Какую роль').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Причина').setMaxLength(500)))
    .addSubcommand((s) => s.setName('extend').setDescription('Продлить временную роль')
      .addUserOption((o) => o.setName('user').setDescription('Кому').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Какую роль').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('На сколько дольше: 1d, 12h').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Временные роли участника или всего сервера')
      .addUserOption((o) => o.setName('user').setDescription('Чьи (пусто — все на сервере)'))),

  async execute(interaction) {
    const fail = (t) => interaction.reply({ embeds: [embeds.error(t)], flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const me = interaction.member;
    if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return fail('Нужно право «Управлять ролями».');
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');

    if (sub === 'list') {
      const where = { guildId: guild.id }; if (user) where.userId = user.id;
      const rows = await TempRole.findAll({ where, order: [['expiresAt', 'ASC']], limit: 25 });
      if (!rows.length) return interaction.reply({ embeds: [embeds.info(user ? `У <@${user.id}> нет временных ролей.` : 'На сервере нет временных ролей.')], flags: MessageFlags.Ephemeral });
      const lines = rows.map((r) => `${user ? '' : `<@${r.userId}> · `}<@&${r.roleId}> — до <t:${unix(r.expiresAt)}:f>${r.caseNumber ? ` · дело #${r.caseNumber}` : ''}${r.reason ? ` · ${r.reason.slice(0, 60)}` : ''}`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(user ? `Временные роли ${user.username}` : 'Временные роли на сервере')], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    const role = interaction.options.getRole('role');
    const bad = roleRefusal(guild, me, role);
    if (bad) return fail(bad);
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (sub !== 'remove' && !member) return fail('Участник не найден на сервере.');
    if (member) { const h = hierarchyError(me, member); if (h) return fail(h); }

    if (sub === 'give') {
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms || ms < 60_000 || ms > MAX_MS) return fail('Срок — от минуты до года, например: 30m, 2h, 7d.');
      const { expiresAt, entry } = await tempRoles.giveWithCase(guild, member, role, ms, { byId: me.id, reason: interaction.options.getString('reason'), dm: Boolean(interaction.options.getBoolean('dm')) });
      return interaction.reply({ embeds: [embeds.success(`<@${user.id}> выдана роль <@&${role.id}> на ${formatDuration(ms)} — до <t:${unix(expiresAt)}:f>. Дело #${entry.caseNumber}.`)], allowedMentions: { parse: [] } });
    }

    const row = await TempRole.findOne({ where: { guildId: guild.id, userId: user.id, roleId: role.id } });
    if (!row) return fail(`У <@${user.id}> нет временной роли <@&${role.id}>.`);
    if (sub === 'remove') {
      await tempRoles.removeWithCase(guild, row, { byId: me.id, reason: interaction.options.getString('reason') });
      return interaction.reply({ embeds: [embeds.success(`Временная роль <@&${role.id}> снята с <@${user.id}>.`)], allowedMentions: { parse: [] } });
    }
    const ms = parseDuration(interaction.options.getString('duration'));
    if (!ms || ms < 60_000 || ms > MAX_MS) return fail('Продление — от минуты до года, например: 1d, 12h.');
    const until = await tempRoles.extendWithCase(row, ms, me.id);
    return interaction.reply({ embeds: [embeds.success(`Роль <@&${role.id}> у <@${user.id}> продлена до <t:${unix(until)}:f>.`)], allowedMentions: { parse: [] } });
  }
};
