// /webhook: create, list, delete webhooks and post through them. The link of a webhook is a password
// (anyone who has it can post), so every answer here is visible only to the person who asked.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { memberHasPermission } = require('../../utils/permissions');
const { getOrCreateSettings } = require('../../modules/leveling');
const { panelPayload, ownWebhooks, listEmbed, createdEmbed, explain } = require('../../modules/webhookPanel');

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia].filter((t) => t !== undefined);
const MAX_AVATAR = 8 * 1024 * 1024;
const ephemeral = { flags: MessageFlags.Ephemeral };

const fail = (interaction, text) => interaction.reply({ embeds: [embeds.error(text)], ...ephemeral });
const idOpt = (o) => o.setName('id').setDescription('ID вебхука (из /webhook list)').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Вебхуки: создать, посмотреть, удалить и отправить сообщение')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Создать вебхук в канале и получить его ссылку (видите только вы)')
      .addChannelOption((o) => o.setName('channel').setDescription('В каком канале').addChannelTypes(...CHANNEL_TYPES).setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('Имя вебхука (1–32 символа)').setRequired(true).setMinLength(1).setMaxLength(32))
      .addAttachmentOption((o) => o.setName('avatar').setDescription('Картинка-аватарка (по умолчанию — аватарка бота)')))
    .addSubcommand((s) => s.setName('panel').setDescription('Разместить в канале панель с кнопками для управления вебхуками')
      .addChannelOption((o) => o.setName('channel').setDescription('Куда разместить (по умолчанию — этот канал)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('list').setDescription('Вебхуки, созданные этим ботом, со ссылками (видите только вы)'))
    .addSubcommand((s) => s.setName('delete').setDescription('Удалить вебхук, созданный этим ботом').addStringOption(idOpt))
    .addSubcommand((s) => s.setName('send').setDescription('Отправить сообщение от имени вебхука')
      .addStringOption(idOpt)
      .addStringOption((o) => o.setName('text').setDescription('Текст сообщения').setRequired(true).setMaxLength(2000))
      .addStringOption((o) => o.setName('username').setDescription('Другое имя отправителя на этот раз').setMaxLength(80))
      .addStringOption((o) => o.setName('avatar_url').setDescription('Ссылка на другую аватарку на этот раз'))),

  async execute(interaction) {
    if (!interaction.guild) return fail(interaction, 'Вебхуки создаются только на сервере.');
    if (!memberHasPermission(interaction.member, 'ManageWebhooks')) return fail(interaction, 'Нужно право «Управлять вебхуками».');
    const guild = interaction.guild;
    const me = guild.members?.me;
    if (me && !me.permissions.has(PermissionFlagsBits.ManageWebhooks)) return fail(interaction, 'У бота нет права «Управлять вебхуками». Выдайте его роли бота и повторите.');

    const sub = interaction.options.getSubcommand();
    const settings = await getOrCreateSettings(guild.id);

    try {
      if (sub === 'panel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        if (!channel || typeof channel.send !== 'function') return fail(interaction, 'Сюда нельзя отправить панель.');
        const sent = await channel.send(panelPayload());
        if (settings.webhookPanelChannelId && settings.webhookPanelMessageId) { // the older panel is replaced, not left next to the new one
          const old = guild.channels.cache.get(settings.webhookPanelChannelId);
          await old?.messages?.delete?.(settings.webhookPanelMessageId).catch(() => {});
        }
        settings.webhookPanelChannelId = channel.id;
        settings.webhookPanelMessageId = sent.id;
        await settings.save();
        return interaction.reply({ embeds: [embeds.success(`Панель размещена в <#${channel.id}>.`)], ...ephemeral });
      }

      if (sub === 'create') {
        const channel = interaction.options.getChannel('channel', true);
        const name = interaction.options.getString('name', true).trim();
        if (!name) return fail(interaction, 'Имя вебхука не может быть пустым.');
        if (typeof channel.createWebhook !== 'function') return fail(interaction, 'В этом канале нельзя создать вебхук.');
        const file = interaction.options.getAttachment?.('avatar');
        if (file && (!String(file.contentType || '').startsWith('image/') || (file.size || 0) > MAX_AVATAR)) return fail(interaction, 'Аватарка должна быть картинкой не тяжелее 8 МБ.');
        const hook = await channel.createWebhook({
          name,
          avatar: file ? file.url : interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }),
          reason: `Создал ${interaction.user.tag || interaction.user.username} через /webhook`
        });
        return interaction.reply({
          embeds: [createdEmbed(hook, channel.id)],
          ...ephemeral
        });
      }

      if (sub === 'list') {
        return interaction.reply({ embeds: [listEmbed(await ownWebhooks(guild, settings))], ...ephemeral });
      }

      const id = interaction.options.getString('id', true).trim();
      const hook = (await ownWebhooks(guild, settings)).find((w) => w.id === id);
      if (!hook) return fail(interaction, 'Такого вебхука нет среди созданных этим ботом. ID можно посмотреть в `/webhook list`.');

      if (sub === 'delete') {
        await hook.delete(`Удалил ${interaction.user.tag || interaction.user.username} через /webhook`);
        return interaction.reply({ embeds: [embeds.success(`Вебхук **${hook.name}** удалён.`)], ...ephemeral });
      }

      // send
      const text = interaction.options.getString('text', true);
      const username = interaction.options.getString('username') || undefined;
      const avatarURL = interaction.options.getString('avatar_url') || undefined;
      if (avatarURL && !/^https?:\/\//i.test(avatarURL)) return fail(interaction, 'Ссылка на аватарку должна начинаться с http:// или https://.');
      await hook.send({ content: text, username, avatarURL, allowedMentions: { parse: [] } }); // no @everyone through a webhook
      return interaction.reply({ embeds: [embeds.success(`Сообщение отправлено от имени **${username || hook.name}** в <#${hook.channelId}>.`)], ...ephemeral });
    } catch (err) {
      const msg = explain(err);
      return interaction.replied || interaction.deferred ? interaction.editReply({ embeds: [embeds.error(msg)] }) : fail(interaction, msg);
    }
  }
};
