const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { CustomCommand, ReactionRole, Alert } = require('../../../db');
const { getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manage')
    .setDescription('Управление кастом-командами, ролями по реакциям, temp-voice и оповещениями')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // ---- custom commands ----
    .addSubcommandGroup((group) =>
      group
        .setName('command')
        .setDescription('Кастомные текстовые команды')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Добавить кастомную команду')
            .addStringOption((opt) => opt.setName('триггер').setDescription('Слово-вызов, без префикса').setRequired(true))
            .addStringOption((opt) => opt.setName('ответ').setDescription('Что ответит бот').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub.setName('remove').setDescription('Удалить кастомную команду').addStringOption((opt) => opt.setName('триггер').setDescription('Слово-вызов').setRequired(true))
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Список кастомных команд'))
    )

    // ---- reaction roles ----
    .addSubcommandGroup((group) =>
      group
        .setName('reactionrole')
        .setDescription('Роли, выдаваемые по реакции на сообщение')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Привязать роль к реакции')
            .addStringOption((opt) => opt.setName('id_сообщения').setDescription('ID сообщения').setRequired(true))
            .addStringOption((opt) => opt.setName('эмодзи').setDescription('Эмодзи (unicode или кастомный)').setRequired(true))
            .addRoleOption((opt) => opt.setName('роль').setDescription('Роль для выдачи').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Убрать привязку роли к реакции')
            .addStringOption((opt) => opt.setName('id_сообщения').setDescription('ID сообщения').setRequired(true))
            .addStringOption((opt) => opt.setName('эмодзи').setDescription('Эмодзи').setRequired(true))
        )
    )

    // ---- temp voice ----
    .addSubcommandGroup((group) =>
      group
        .setName('tempvoice')
        .setDescription('Временные голосовые каналы "зайди — создастся"')
        .addSubcommand((sub) =>
          sub
            .setName('setup')
            .setDescription('Настроить триггер-канал для temp-voice')
            .addChannelOption((opt) => opt.setName('канал').setDescription('Голосовой канал-триггер').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
            .addChannelOption((opt) => opt.setName('категория').setDescription('Категория для новых каналов').addChannelTypes(ChannelType.GuildCategory))
            .addStringOption((opt) => opt.setName('шаблон_имени').setDescription('Например: Комната {user}'))
        )
        .addSubcommand((sub) => sub.setName('disable').setDescription('Отключить temp-voice'))
    )

    // ---- alerts ----
    .addSubcommandGroup((group) =>
      group
        .setName('alert')
        .setDescription('Оповещения о новых видео/стримах YouTube и Twitch')
        .addSubcommand((sub) =>
          sub
            .setName('youtube')
            .setDescription('Подписаться на YouTube-канал')
            .addStringOption((opt) => opt.setName('id_канала').setDescription('ID YouTube-канала (UC...)').setRequired(true))
            .addChannelOption((opt) => opt.setName('куда_постить').setDescription('Канал Discord для уведомлений').addChannelTypes(ChannelType.GuildText).setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('twitch')
            .setDescription('Подписаться на Twitch-канал')
            .addStringOption((opt) => opt.setName('логин').setDescription('Логин Twitch-канала (как в URL twitch.tv/логин)').setRequired(true))
            .addChannelOption((opt) => opt.setName('куда_постить').setDescription('Канал Discord для уведомлений').addChannelTypes(ChannelType.GuildText).setRequired(true))
        )
        .addSubcommand((sub) => sub.setName('remove').setDescription('Удалить подписку по ID').addIntegerOption((opt) => opt.setName('id').setDescription('ID подписки (см. /manage alert list)').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('Список подписок на этом сервере'))
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    // ===== custom commands =====
    if (group === 'command') {
      if (sub === 'add') {
        const trigger = interaction.options.getString('триггер').toLowerCase();
        const response = interaction.options.getString('ответ');
        await CustomCommand.upsert({ guildId: interaction.guild.id, trigger, response, createdBy: interaction.user.id });
        return interaction.reply({ embeds: [embeds.success(`Команда \`${trigger}\` сохранена.`)] });
      }
      if (sub === 'remove') {
        const trigger = interaction.options.getString('триггер').toLowerCase();
        const deleted = await CustomCommand.destroy({ where: { guildId: interaction.guild.id, trigger } });
        return interaction.reply({
          embeds: [deleted ? embeds.success(`Команда \`${trigger}\` удалена.`) : embeds.error('Команда с таким триггером не найдена.')]
        });
      }
      if (sub === 'list') {
        const commands = await CustomCommand.findAll({ where: { guildId: interaction.guild.id } });
        if (!commands.length) return interaction.reply({ embeds: [embeds.info('Кастомных команд пока нет.')] });
        const settings = await getOrCreateSettings(interaction.guild.id);
        const lines = commands.map((c) => `\`${settings.prefix}${c.trigger}\``);
        return interaction.reply({ embeds: [embeds.info(lines.join(', ')).setTitle(`Кастомные команды (${commands.length})`)] });
      }
    }

    // ===== reaction roles =====
    if (group === 'reactionrole') {
      const messageId = interaction.options.getString('id_сообщения');

      if (sub === 'add') {
        const emojiInput = interaction.options.getString('эмодзи');
        const role = interaction.options.getRole('роль');
        const emojiMatch = emojiInput.match(/^<a?:\w+:(\d+)>$/);
        const emoji = emojiMatch ? emojiMatch[1] : emojiInput;

        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (!message) return interaction.reply({ embeds: [embeds.error('Сообщение не найдено в этом канале.')], ephemeral: true });

        await ReactionRole.upsert({ guildId: interaction.guild.id, channelId: interaction.channel.id, messageId, emoji, roleId: role.id });
        await message.react(emojiInput).catch(() => {});
        return interaction.reply({ embeds: [embeds.success(`Реакция ${emojiInput} теперь выдаёт роль ${role}.`)] });
      }

      if (sub === 'remove') {
        const emojiInput = interaction.options.getString('эмодзи');
        const emojiMatch = emojiInput.match(/^<a?:\w+:(\d+)>$/);
        const emoji = emojiMatch ? emojiMatch[1] : emojiInput;
        const deleted = await ReactionRole.destroy({ where: { messageId, emoji } });
        return interaction.reply({
          embeds: [deleted ? embeds.success('Привязка удалена.') : embeds.error('Привязка не найдена.')],
          ephemeral: true
        });
      }
    }

    // ===== temp voice =====
    if (group === 'tempvoice') {
      const settings = await getOrCreateSettings(interaction.guild.id);

      if (sub === 'setup') {
        settings.tempVoiceJoinChannelId = interaction.options.getChannel('канал').id;
        const category = interaction.options.getChannel('категория');
        if (category) settings.tempVoiceCategoryId = category.id;
        const template = interaction.options.getString('шаблон_имени');
        if (template) settings.tempVoiceNameTemplate = template;
        await settings.save();
        return interaction.reply({ embeds: [embeds.success('Temp-voice настроен. Заходите в триггер-канал, чтобы проверить.')] });
      }

      if (sub === 'disable') {
        settings.tempVoiceJoinChannelId = null;
        settings.tempVoiceCategoryId = null;
        await settings.save();
        return interaction.reply({ embeds: [embeds.success('Temp-voice отключён.')] });
      }
    }

    // ===== alerts =====
    if (group === 'alert') {
      if (sub === 'youtube' || sub === 'twitch') {
        if (sub === 'youtube' && !process.env.YOUTUBE_API_KEY) {
          return interaction.reply({ embeds: [embeds.error('YOUTUBE_API_KEY не настроен на сервере — оповещения YouTube недоступны.')], ephemeral: true });
        }
        if (sub === 'twitch' && (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET)) {
          return interaction.reply({ embeds: [embeds.error('TWITCH_CLIENT_ID/SECRET не настроены на сервере — оповещения Twitch недоступны.')], ephemeral: true });
        }

        const channel = interaction.options.getChannel('куда_постить');
        const targetId = sub === 'youtube' ? interaction.options.getString('id_канала') : interaction.options.getString('логин').toLowerCase();

        await Alert.upsert({ guildId: interaction.guild.id, channelId: channel.id, platform: sub, targetId });
        return interaction.reply({ embeds: [embeds.success(`Подписка на ${sub === 'youtube' ? 'YouTube' : 'Twitch'}-канал добавлена, уведомления будут приходить в ${channel}.`)] });
      }

      if (sub === 'remove') {
        const id = interaction.options.getInteger('id');
        const deleted = await Alert.destroy({ where: { id, guildId: interaction.guild.id } });
        return interaction.reply({ embeds: [deleted ? embeds.success('Подписка удалена.') : embeds.error('Подписка с таким ID не найдена.')], ephemeral: true });
      }

      if (sub === 'list') {
        const alerts = await Alert.findAll({ where: { guildId: interaction.guild.id } });
        if (!alerts.length) return interaction.reply({ embeds: [embeds.info('Подписок пока нет.')] });
        const lines = alerts.map((a) => `**#${a.id}** ${a.platform === 'youtube' ? '📺' : '🟣'} ${a.targetName || a.targetId} → <#${a.channelId}>`);
        return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle(`Подписки (${alerts.length})`)] });
      }
    }
  }
};
