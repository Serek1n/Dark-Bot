// /voice: the same actions as the buttons of the room control panel, as commands.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { isAdmin } = require('../../utils/permissions');
const room = require('../../modules/voiceRoom');

const user = (o, text = 'Участник') => o.setName('user').setDescription(text).setRequired(true);
const ephemeral = { flags: MessageFlags.Ephemeral };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Управление личной голосовой комнатой')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('panel').setDescription('Разместить в канале сообщение с кнопками управления комнатами (для администраторов)')
      .addChannelOption((o) => o.setName('channel').setDescription('Куда поместить (по умолчанию — этот канал)')))
    .addSubcommand((s) => s.setName('info').setDescription('Сведения о вашей комнате'))
    .addSubcommand((s) => s.setName('name').setDescription('Сменить название комнаты').addStringOption((o) => o.setName('name').setDescription('Новое название').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('limit').setDescription('Лимит участников в комнате').addIntegerOption((o) => o.setName('count').setDescription('От 1 до 99, 0 — без лимита').setRequired(true).setMinValue(0).setMaxValue(99)))
    .addSubcommand((s) => s.setName('access').setDescription('Открыть, закрыть или скрыть комнату')
      .addStringOption((o) => o.setName('mode').setDescription('Кто может зайти').setRequired(true).addChoices(...Object.entries(room.ACCESS).map(([value, a]) => ({ name: a.label, value })))))
    .addSubcommand((s) => s.setName('trust').setDescription('Доверить комнату: заходит, даже когда она закрыта').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('untrust').setDescription('Убрать доверие').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('invite').setDescription('Пригласить в комнату (бот напишет в личные сообщения)').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('kick').setDescription('Выгнать из комнаты').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('ban').setDescription('Запретить участнику заходить в комнату').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('unban').setDescription('Снять запрет').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('region').setDescription('Регион голосового сервера')
      .addStringOption((o) => o.setName('region').setDescription('Регион').setRequired(true).addChoices(...room.REGIONS.map(([value, name]) => ({ name, value })))))
    .addSubcommand((s) => s.setName('transfer').setDescription('Передать комнату другому участнику, который в ней сидит').addUserOption((o) => user(o)))
    .addSubcommand((s) => s.setName('claim').setDescription('Забрать комнату, если её владелец вышел'))
    .addSubcommand((s) => s.setName('delete').setDescription('Удалить свою комнату')),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ embeds: [embeds.error('Комнатами можно управлять только на сервере.')], ...ephemeral });
    const sub = interaction.options.getSubcommand();
    const done = (text) => interaction.reply({ embeds: [embeds.success(text)], ...ephemeral });

    try {
      if (sub === 'panel') {
        if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [embeds.error('Разместить панель могут только администраторы сервера.')], ...ephemeral });
        const target = interaction.options.getChannel('channel') || interaction.channel;
        if (!target?.send) return interaction.reply({ embeds: [embeds.error('В этот канал нельзя отправить сообщение.')], ...ephemeral });
        await target.send(room.panelPayload());
        return done(`Панель управления комнатами размещена в <#${target.id}>.`);
      }
      if (sub === 'claim') return done(await room.claim(guild, interaction.member));

      const ctx = await room.findRoom(guild, interaction.member);
      const id = () => interaction.options.getUser('user', true).id;
      if (sub === 'info') return interaction.reply({ embeds: [room.describe(ctx)], ...ephemeral, allowedMentions: { parse: [] } });
      if (sub === 'name') return done(await room.rename(ctx, interaction.options.getString('name', true)));
      if (sub === 'limit') return done(await room.rename(ctx, null, interaction.options.getInteger('count', true)));
      if (sub === 'access') return done(await room.setAccess(ctx, interaction.options.getString('mode', true)));
      if (sub === 'region') return done(await room.setRegion(ctx, interaction.options.getString('region', true)));
      if (sub === 'transfer') return done(await room.transfer(ctx, id()));
      if (sub === 'delete') return done(await room.removeRoom(ctx));
      const many = { trust: room.trust, untrust: room.untrust, invite: room.invite, kick: room.kick, ban: room.ban, unban: room.unban }[sub];
      return done(await many(ctx, [id()]));
    } catch (err) {
      if (!(err instanceof room.RoomError)) logger.error(`/voice ${sub} failed:`, err);
      const text = err instanceof room.RoomError ? err.message : 'Не получилось выполнить действие. Проверьте права бота: «Управлять каналами», «Управлять ролями», «Перемещать участников».';
      const payload = { embeds: [embeds.error(text)], ...ephemeral };
      return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
    }
  }
};
