const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { ReactionRole } = require('../../../db');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Настройка ролей по реакциям')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Привязать роль к реакции на сообщение')
        .addStringOption((opt) => opt.setName('id_сообщения').setDescription('ID сообщения').setRequired(true))
        .addChannelOption((opt) => opt.setName('канал').setDescription('Канал с сообщением').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((opt) => opt.setName('эмодзи').setDescription('Эмодзи (юникод или кастомный)').setRequired(true))
        .addRoleOption((opt) => opt.setName('роль').setDescription('Роль, которая будет выдаваться').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Убрать привязку роли к реакции')
        .addStringOption((opt) => opt.setName('id_сообщения').setDescription('ID сообщения').setRequired(true))
        .addStringOption((opt) => opt.setName('эмодзи').setDescription('Эмодзи').setRequired(true))
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const messageId = interaction.options.getString('id_сообщения');
      const channel = interaction.options.getChannel('канал');
      const emojiInput = interaction.options.getString('эмодзи');
      const role = interaction.options.getRole('роль');

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        return interaction.reply({ embeds: [embeds.error('Сообщение не найдено в указанном канале.')], ephemeral: true });
      }

      await message.react(emojiInput).catch(() => {});
      // Normalize emoji key: custom emoji like <:name:id> -> id, otherwise the unicode itself
      const customMatch = emojiInput.match(/^<a?:\w+:(\d+)>$/);
      const emojiKey = customMatch ? customMatch[1] : emojiInput;

      await ReactionRole.upsert({ guildId: interaction.guild.id, channelId: channel.id, messageId, emoji: emojiKey, roleId: role.id });

      return interaction.reply({ embeds: [embeds.success(`Готово! Реакция ${emojiInput} на сообщении теперь выдаёт роль <@&${role.id}>.`)], ephemeral: true });
    }

    if (sub === 'remove') {
      const messageId = interaction.options.getString('id_сообщения');
      const emojiInput = interaction.options.getString('эмодзи');
      const customMatch = emojiInput.match(/^<a?:\w+:(\d+)>$/);
      const emojiKey = customMatch ? customMatch[1] : emojiInput;

      const deleted = await ReactionRole.destroy({ where: { messageId, emoji: emojiKey, guildId: interaction.guild.id } });
      return interaction.reply({
        embeds: [deleted ? embeds.success('Привязка удалена.') : embeds.error('Привязка не найдена.')],
        ephemeral: true
      });
    }
  }
};
