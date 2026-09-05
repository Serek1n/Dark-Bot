const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Warning } = require('../../../db');
const { recordAndAnnounce } = require('../../utils/modlog');
const embeds = require('../../utils/embeds');
const { memberHasPermission } = require('../../utils/permissions');

function denyPermission(interaction, permName) {
  return interaction.reply({
    embeds: [embeds.error(`Для этого действия нужно право **${permName}**.`)],
    ephemeral: true
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Команды модерации сервера')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('Выдать предупреждение участнику')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кому выдать предупреждение').setRequired(true))
        .addStringOption((opt) => opt.setName('причина').setDescription('Причина'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('unwarn')
        .setDescription('Снять предупреждение по номеру (см. /moderation warnings)')
        .addIntegerOption((opt) => opt.setName('номер').setDescription('ID предупреждения').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('warnings')
        .setDescription('Показать предупреждения участника')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого проверить').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('mute')
        .setDescription('Замутить участника (timeout)')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого замутить').setRequired(true))
        .addIntegerOption((opt) => opt.setName('минуты').setDescription('На сколько минут').setRequired(true).setMinValue(1).setMaxValue(40320))
        .addStringOption((opt) => opt.setName('причина').setDescription('Причина'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('unmute')
        .setDescription('Снять мут с участника')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого размутить').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Кикнуть участника')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого кикнуть').setRequired(true))
        .addStringOption((opt) => opt.setName('причина').setDescription('Причина'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ban')
        .setDescription('Забанить участника')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Кого забанить').setRequired(true))
        .addStringOption((opt) => opt.setName('причина').setDescription('Причина'))
        .addIntegerOption((opt) => opt.setName('дней_удалить').setDescription('Удалить сообщения за N дней (0-7)').setMinValue(0).setMaxValue(7))
    )
    .addSubcommand((sub) =>
      sub
        .setName('unban')
        .setDescription('Разбанить участника по ID')
        .addStringOption((opt) => opt.setName('id').setDescription('ID пользователя').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Удалить последние сообщения в канале')
        .addIntegerOption((opt) => opt.setName('количество').setDescription('Сколько сообщений удалить (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Base command permission is ModerateMembers; some actions need a stronger permission.
    if (sub === 'kick' && !memberHasPermission(interaction.member, 'KickMembers')) return denyPermission(interaction, 'Kick Members');
    if ((sub === 'ban' || sub === 'unban') && !memberHasPermission(interaction.member, 'BanMembers')) return denyPermission(interaction, 'Ban Members');
    if (sub === 'clear' && !memberHasPermission(interaction.member, 'ManageMessages')) return denyPermission(interaction, 'Manage Messages');

    if (sub === 'warn') {
      const target = interaction.options.getUser('пользователь');
      const reason = interaction.options.getString('причина') || 'Без причины';
      await Warning.create({ guildId: interaction.guild.id, userId: target.id, moderatorId: interaction.user.id, reason });
      await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'warn', reason });
      await interaction.reply({ embeds: [embeds.success(`<@${target.id}> получил(а) предупреждение: ${reason}`)] });
      await interaction.client.users.send(target.id, `Вы получили предупреждение на сервере **${interaction.guild.name}**: ${reason}`).catch(() => {});
      return;
    }

    if (sub === 'unwarn') {
      const id = interaction.options.getInteger('номер');
      const warning = await Warning.findOne({ where: { id, guildId: interaction.guild.id } });
      if (!warning) return interaction.reply({ embeds: [embeds.error('Предупреждение с таким номером не найдено.')], ephemeral: true });
      await warning.destroy();
      await recordAndAnnounce(interaction.guild, { userId: warning.userId, moderatorId: interaction.user.id, action: 'unwarn', reason: `Снято предупреждение #${id}` });
      return interaction.reply({ embeds: [embeds.success(`Предупреждение #${id} снято.`)] });
    }

    if (sub === 'warnings') {
      const target = interaction.options.getUser('пользователь');
      const warnings = await Warning.findAll({ where: { guildId: interaction.guild.id, userId: target.id }, order: [['createdAt', 'DESC']] });
      if (!warnings.length) return interaction.reply({ embeds: [embeds.info(`У <@${target.id}> нет предупреждений.`)] });
      const lines = warnings.map((w) => `**#${w.id}** — ${w.reason} (от <@${w.moderatorId}>, ${w.createdAt.toLocaleDateString('ru-RU')})`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(`Предупреждения ${target.username} (${warnings.length})`)] });
    }

    if (sub === 'mute') {
      const target = interaction.options.getUser('пользователь');
      const minutes = interaction.options.getInteger('минуты');
      const reason = interaction.options.getString('причина') || 'Без причины';
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });
      if (!member.moderatable) return interaction.reply({ embeds: [embeds.error('Не могу замутить этого участника (роль выше моей).')], ephemeral: true });
      await member.timeout(minutes * 60 * 1000, reason);
      await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'mute', reason: `${reason} (${minutes} мин)` });
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> замучен(а) на ${minutes} мин: ${reason}`)] });
    }

    if (sub === 'unmute') {
      const target = interaction.options.getUser('пользователь');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });
      await member.timeout(null);
      await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'unmute' });
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> размучен(а).`)] });
    }

    if (sub === 'kick') {
      const target = interaction.options.getUser('пользователь');
      const reason = interaction.options.getString('причина') || 'Без причины';
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [embeds.error('Участник не найден.')], ephemeral: true });
      if (!member.kickable) return interaction.reply({ embeds: [embeds.error('Не могу кикнуть этого участника.')], ephemeral: true });
      await member.kick(reason);
      await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'kick', reason });
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> кикнут(а): ${reason}`)] });
    }

    if (sub === 'ban') {
      const target = interaction.options.getUser('пользователь');
      const reason = interaction.options.getString('причина') || 'Без причины';
      const deleteDays = interaction.options.getInteger('дней_удалить') || 0;
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member && !member.bannable) return interaction.reply({ embeds: [embeds.error('Не могу забанить этого участника.')], ephemeral: true });
      await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
      await recordAndAnnounce(interaction.guild, { userId: target.id, moderatorId: interaction.user.id, action: 'ban', reason });
      return interaction.reply({ embeds: [embeds.success(`<@${target.id}> забанен(а): ${reason}`)] });
    }

    if (sub === 'unban') {
      const userId = interaction.options.getString('id');
      try {
        await interaction.guild.members.unban(userId);
      } catch {
        return interaction.reply({ embeds: [embeds.error('Не удалось разбанить: пользователь не найден в бан-листе.')], ephemeral: true });
      }
      await recordAndAnnounce(interaction.guild, { userId, moderatorId: interaction.user.id, action: 'unban' });
      return interaction.reply({ embeds: [embeds.success(`Пользователь <@${userId}> разбанен.`)] });
    }

    if (sub === 'clear') {
      const amount = interaction.options.getInteger('количество');
      const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
      if (!deleted) return interaction.reply({ embeds: [embeds.error('Не удалось удалить сообщения (возможно, они старше 14 дней).')], ephemeral: true });
      await recordAndAnnounce(interaction.guild, {
        userId: interaction.user.id,
        moderatorId: interaction.user.id,
        action: 'clear',
        reason: `Удалено ${deleted.size} сообщений в #${interaction.channel.name}`
      });
      return interaction.reply({ embeds: [embeds.success(`Удалено ${deleted.size} сообщений.`)], ephemeral: true });
    }
  }
};
