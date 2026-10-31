// /temprole — a role for a while (as Lacuna's temprole): "выдана до …", taken away automatically.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { give } = require('../../modules/tempRoles');
const { TempRole } = require('../../../db');

const MAX_MS = 366 * 24 * 3600 * 1000;
const DANGEROUS = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageWebhooks;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Выдать роль на время')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('give').setDescription('Выдать роль на время')
      .addUserOption((o) => o.setName('user').setDescription('Кому').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Какую роль').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('На сколько: 30m, 2h, 7d, 0.5h, 1y').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Временные роли участника')
      .addUserOption((o) => o.setName('user').setDescription('Чьи').setRequired(true))),

  async execute(interaction) {
    const fail = (t) => interaction.reply({ embeds: [embeds.error(t)], flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const me = interaction.member;
    if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return fail('Нужно право «Управлять ролями».');
    const user = interaction.options.getUser('user');

    if (interaction.options.getSubcommand() === 'list') {
      const rows = await TempRole.findAll({ where: { guildId: guild.id, userId: user.id }, order: [['expiresAt', 'ASC']] });
      if (!rows.length) return interaction.reply({ embeds: [embeds.info(`У <@${user.id}> нет временных ролей.`)], flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [embeds.info(rows.map((r) => `<@&${r.roleId}> — до <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:f>`).join('\n'))], flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('role');
    const ms = parseDuration(interaction.options.getString('duration'));
    if (!ms || ms < 60_000 || ms > MAX_MS) return fail('Срок — от минуты до года, например: 30m, 2h, 7d.');
    if (role.managed || role.id === guild.id) return fail('Эту роль выдать нельзя: ею управляет Discord или интеграция.');
    const isOwner = guild.ownerId === me.id;
    if (!isOwner && role.position >= (me.roles?.highest?.position ?? 0)) return fail('Роль должна быть ниже вашей высшей роли.');
    if (!isOwner && !me.permissions.has(PermissionFlagsBits.Administrator) && (BigInt(role.permissions?.bitfield ?? 0n) & DANGEROUS) !== 0n) return fail('Роли с правами модерации выдаёт только администратор.');
    if (role.editable === false) return fail('Бот не может выдать эту роль: его роль должна быть выше.');
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return fail('Участник не найден на сервере.');
    const until = await give(guild, member, role, ms, me.id);
    return interaction.reply({ embeds: [embeds.success(`<@${user.id}> выдана роль <@&${role.id}> на ${formatDuration(ms)} — до <t:${Math.floor(until.getTime() / 1000)}:f>.`)], allowedMentions: { parse: [] } });
  }
};
