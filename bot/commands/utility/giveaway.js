const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { canSelfGive } = require('../../utils/safeRole');
const { getOrCreateSettings } = require('../../modules/leveling');
const { Giveaway } = require('../../../db');
const embeds = require('../../utils/embeds');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { isAdmin } = require('../../utils/permissions');
const { startGiveaway, finishGiveaway } = require('../../modules/giveaways');

const MIN_MS = 10_000;
const MAX_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE = 10;
const MAX_AMOUNT = 10_000_000;
const ROLE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');

/**
 * The prize the bot pays out by itself, from the command options. Returns { reward } (null = no automatic prize),
 * or { error } with the text for the person. Type may be left out: a role means "role", an amount means coins.
 */
function readReward(interaction) {
  const o = interaction.options;
  const role = o.getRole('reward_role');
  const amount = o.getInteger('reward_amount');
  const time = o.getString('reward_time');
  const type = o.getString('reward') || (role ? 'role' : amount ? 'coins' : null);
  if (!type) return (time ? { error: 'Срок указывают для приза-роли: добавьте `reward_role`.' } : { reward: null });
  if (type === 'coins' || type === 'crystals') {
    if (!amount || amount < 1 || amount > MAX_AMOUNT) return { error: `Укажите \`reward_amount\` — сколько получит каждый победитель (от 1 до ${fmt(MAX_AMOUNT)}).` };
    return { reward: { type, amount } };
  }
  if (!role) return { error: 'Укажите роль-приз: `reward_role`.' };
  const guild = interaction.guild;
  const r = guild.roles.cache.get(role.id) || role;
  if (r.id === guild.id || r.managed) return { error: 'Эту роль выдавать нельзя: ею управляет Discord или интеграция.' };
  if (!canSelfGive(r, guild)) return { error: 'Эта роль даёт права управления сервером — разыгрывать её нельзя.' };
  const isOwner = guild.ownerId === interaction.user.id;
  const top = interaction.member?.roles?.highest?.position ?? 0;
  if (!isOwner && (r.position ?? 0) >= top) return { error: 'Разыгрывать можно только роль ниже вашей высшей роли.' };
  let seconds = null;
  if (time) {
    const ms = parseDuration(time);
    if (!ms || ms < 60_000 || ms > ROLE_MAX_MS) return { error: 'Срок роли — от 1 минуты до 366 дней, например: 7d, 12h, 1мес.' };
    seconds = Math.round(ms / 1000);
  }
  return { reward: { type: 'role', roleId: r.id, seconds, roleName: r.name } };
}

module.exports = {
  readReward,
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Розыгрыши призов с таймером и случайным выбором победителей')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('start').setDescription('Начать розыгрыш (приз можно выдать автоматически)')
      .addStringOption((o) => o.setName('duration').setDescription('Сколько длится: 30m, 2h, 1d (до 60 дней)').setRequired(true))
      .addStringOption((o) => o.setName('prize').setDescription('Что разыгрываем (можно не писать, если приз выдаёт бот)').setMaxLength(200))
      .addIntegerOption((o) => o.setName('winners').setDescription('Сколько победителей (по умолчанию 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption((o) => o.setName('role').setDescription('Участвовать смогут только обладатели этой роли'))
      .addStringOption((o) => o.setName('reward').setDescription('Бот сам выдаст приз победителям').addChoices(
        { name: 'Монеты', value: 'coins' }, { name: 'Кристаллы', value: 'crystals' }, { name: 'Роль', value: 'role' }))
      .addIntegerOption((o) => o.setName('reward_amount').setDescription('Сколько монет или кристаллов получит каждый победитель').setMinValue(1).setMaxValue(MAX_AMOUNT))
      .addRoleOption((o) => o.setName('reward_role').setDescription('Роль, которую получат победители'))
      .addStringOption((o) => o.setName('reward_time').setDescription('На сколько выдать роль: 7d, 12h, 1мес (пусто — навсегда)'))
      .addChannelOption((o) => o.setName('channel').setDescription('Где опубликовать (по умолчанию — здесь)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('end').setDescription('Закончить розыгрыш досрочно').addIntegerOption((o) => o.setName('id').setDescription('Номер розыгрыша').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Выбрать новых победителей завершённого розыгрыша').addIntegerOption((o) => o.setName('id').setDescription('Номер розыгрыша').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('list').setDescription('Идущие розыгрыши сервера')),

  async execute(interaction) {
    const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return deny('Розыгрыши работают только на сервере.');
    if (!isAdmin(interaction.member)) return deny('Розыгрыши могут проводить только администраторы сервера.');
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'start') {
      const durationMs = parseDuration(interaction.options.getString('duration', true));
      if (!durationMs || durationMs < MIN_MS || durationMs > MAX_MS) return deny('Укажите срок от 10 секунд до 60 дней, например: 30m, 2h или 1d.');
      if ((await Giveaway.count({ where: { guildId, ended: false } })) >= MAX_ACTIVE) return deny(`Одновременно можно держать не больше ${MAX_ACTIVE} розыгрышей.`);
      const { reward, error } = readReward(interaction);
      if (error) return deny(error);
      const settings = reward ? await getOrCreateSettings(guildId) : null;
      const autoPrize = !reward ? null : reward.type === 'coins' ? `${fmt(reward.amount)} ${settings.currencyName}` : reward.type === 'crystals' ? `${fmt(reward.amount)} ${settings.crystalName}` : `Роль «${reward.roleName}»${reward.seconds ? ` на ${formatDuration(reward.seconds * 1000)}` : ''}`;
      const prize = (interaction.options.getString('prize') || '').trim() || autoPrize;
      if (!prize) return deny('Напишите, что разыгрываете (`prize`), или выберите приз, который бот выдаст сам (`reward`).');
      // Another channel: the bot must be able to post there, and the organiser must see it and be allowed to write there.
      const picked = interaction.options.getChannel('channel');
      const channel = picked ? interaction.guild.channels.cache.get(picked.id) || picked : interaction.channel;
      if (picked) {
        const userCan = channel.permissionsFor?.(interaction.member)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
        if (!userCan) return deny('Вы не можете писать в этом канале.');
      }
      // The bot posts the giveaway, edits it with the counter and the result, and answers under it: say what it lacks before starting.
      const { missingIn } = require('../../utils/missingPermissions');
      const lacks = missingIn(channel, interaction.guild.members.me, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']);
      if (lacks.length) return deny(`У бота не хватает прав в <#${channel.id}>: ${require('../../utils/permissionNames').list(lacks)}. Выдайте их роли бота в настройках канала или сервера.`);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const giveaway = await startGiveaway(interaction, {
        prize: prize.slice(0, 200),
        durationMs,
        winners: interaction.options.getInteger('winners') || 1,
        roleId: interaction.options.getRole('role')?.id,
        reward,
        channel
      });
      const where = channel.id !== interaction.channelId ? ` в <#${channel.id}>` : '';
      const auto = reward ? ' Приз бот выдаст победителям сам.' : '';
      return interaction.editReply({ embeds: [embeds.success(`Розыгрыш №${giveaway.id} начался${where} и закончится через ${formatDuration(durationMs)}.${auto}`)] });
    }

    if (sub === 'list') {
      const rows = await Giveaway.findAll({ where: { guildId, ended: false }, order: [['endsAt', 'ASC']], limit: 25 });
      if (!rows.length) return interaction.reply({ embeds: [embeds.info('Сейчас розыгрышей нет. Начните новый: `/giveaway start`.')], flags: MessageFlags.Ephemeral });
      const lines = rows.map((g) => `**№${g.id}** ${g.prize}${g.rewardType ? ' 🎁' : ''} — закончится <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>, <#${g.channelId}>`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    const giveaway = await Giveaway.findOne({ where: { id: interaction.options.getInteger('id', true), guildId } });
    if (!giveaway) return deny('Розыгрыш с таким номером не найден.');
    if (sub === 'end') {
      if (giveaway.ended) return deny('Этот розыгрыш уже закончился. Выбрать новых победителей можно через `/giveaway reroll`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await finishGiveaway(interaction.client, giveaway);
      return interaction.editReply({ embeds: [embeds.success(`Розыгрыш №${giveaway.id} завершён.`)] });
    }
    // reroll
    if (!giveaway.ended) return deny('Розыгрыш ещё идёт. Сначала закончите его: `/giveaway end`.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const winners = await finishGiveaway(interaction.client, giveaway, { reroll: true });
    const kept = giveaway.rewardType ? ' Прежним победителям выданный приз остаётся, новым он начислен.' : '';
    return interaction.editReply({ embeds: [winners?.length ? embeds.success(`Новые победители: ${winners.map((id) => `<@${id}>`).join(', ')}.${kept}`) : embeds.info('Больше нет подходящих участников.')], allowedMentions: { parse: [] } });
  }
};
