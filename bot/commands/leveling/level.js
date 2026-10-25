// /level add | remove | set — change a member's level from Discord (the same as "Изменить уровень участника" in the panel).
// Only for those with "Manage Server". The member lands at the start of the new level; level roles follow at once
// (a lower level takes away the roles that are no longer reached). No crystals are paid for such a change.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { MemberProfile } = require('../../../db');
const { computeLevelAdjust, getOrCreateSettings, MAX_LEVEL } = require('../../modules/leveling');
const { computeAdjustRoleChanges, getLevelRoles } = require('../../modules/levelRoles');
const embeds = require('../../utils/embeds');

const amountOpt = (min) => (o) => o.setName('amount').setDescription('Сколько уровней').setMinValue(min).setMaxValue(MAX_LEVEL).setRequired(true);
const userOpt = (o) => o.setName('user').setDescription('Участник').setRequired(true);

/** Changes the level in the database without losing XP the bot adds at the same moment. Returns the result or null. */
async function adjustLevel(guildId, userId, mode, amount) {
  await MemberProfile.findOrCreate({ where: { guildId, userId } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await MemberProfile.findOne({ where: { guildId, userId } });
    const next = computeLevelAdjust(p, mode, amount);
    const [changed] = await MemberProfile.update(
      { xp: next.xp, level: next.level, chatXp: next.chatXp, voiceXp: next.voiceXp },
      { where: { guildId, userId, xp: p.xp, chatXp: p.chatXp, voiceXp: p.voiceXp } }
    );
    if (changed) return next;
  }
  return null;
}

module.exports = {
  adjustLevel,
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Изменить уровень участника')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Добавить уровни').addUserOption(userOpt).addIntegerOption(amountOpt(1)))
    .addSubcommand((s) => s.setName('remove').setDescription('Убрать уровни').addUserOption(userOpt).addIntegerOption(amountOpt(1)))
    .addSubcommand((s) => s.setName('set').setDescription('Задать точный уровень').addUserOption(userOpt).addIntegerOption(amountOpt(0))),

  async execute(interaction) {
    const fail = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return fail('Для этого нужно право **Управлять сервером**.');
    const mode = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (user.bot) return fail('У ботов нет уровней.');
    const amount = interaction.options.getInteger('amount');
    const guild = interaction.guild;

    const result = await adjustLevel(guild.id, user.id, mode, amount);
    if (!result) return fail('Не получилось: опыт участника менялся слишком часто. Попробуйте ещё раз.');

    let rolesNote = '';
    const member = await guild.members.fetch(user.id).catch(() => null);
    const levelRoles = await getLevelRoles(guild.id);
    if (member && levelRoles.length) {
      const settings = await getOrCreateSettings(guild.id);
      const { add, remove } = computeAdjustRoleChanges(levelRoles, result.level, [...member.roles.cache.keys()], settings.levelRolesReplace, result.level < result.previousLevel);
      let failed = 0;
      const reason = 'Уровень изменён командой /level';
      for (const id of add) await member.roles.add(id, reason).catch(() => { failed++; });
      for (const id of remove) await member.roles.remove(id, reason).catch(() => { failed++; });
      if (add.length || remove.length) rolesNote = failed ? '\n⚠️ Часть ролей за уровни изменить не удалось: роль бота должна быть выше них.' : '\nРоли за уровни обновлены.';
    }
    return interaction.reply({ embeds: [embeds.success(`Уровень <@${user.id}>: ${result.previousLevel} → **${result.level}**.${rolesNote}`)], allowedMentions: { parse: [] } });
  }
};
