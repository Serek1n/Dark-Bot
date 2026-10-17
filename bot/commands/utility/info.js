const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const VERIFICATION = ['нет', 'низкий', 'средний', 'высокий', 'очень высокий'];

async function userInfo(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
  const embed = embeds.baseEmbed().setTitle(user.globalName || user.username).setThumbnail(user.displayAvatarURL({ size: 256 }));
  embed.addFields(
    { name: 'Имя пользователя', value: `${user.username}${user.bot ? ' · бот' : ''}`, inline: true },
    { name: 'ID', value: user.id, inline: true },
    { name: 'Аккаунт создан', value: `<t:${unix(user.createdTimestamp ?? user.createdAt)}:D> (<t:${unix(user.createdTimestamp ?? user.createdAt)}:R>)` }
  );
  if (member) {
    if (member.joinedTimestamp) embed.addFields({ name: 'На сервере с', value: `<t:${unix(member.joinedTimestamp)}:D> (<t:${unix(member.joinedTimestamp)}:R>)` });
    const roles = [...(member.roles?.cache?.values?.() || [])].filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
    const shown = roles.slice(0, 15).map((r) => `<@&${r.id}>`).join(' ');
    embed.addFields({ name: `Роли (${roles.length})`, value: shown ? shown + (roles.length > 15 ? ` и ещё ${roles.length - 15}` : '') : 'нет' });
    if (member.premiumSinceTimestamp) embed.addFields({ name: 'Бустит сервер с', value: `<t:${unix(member.premiumSinceTimestamp)}:D>`, inline: true });
    if (member.communicationDisabledUntilTimestamp > Date.now()) embed.addFields({ name: 'В муте до', value: `<t:${unix(member.communicationDisabledUntilTimestamp)}:f>`, inline: true });
  } else if (interaction.guild) {
    embed.setFooter({ text: 'Этого участника нет на сервере' });
  }
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function serverInfo(interaction) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ embeds: [embeds.error('Эта команда работает только на сервере.')], flags: MessageFlags.Ephemeral });
  const channels = [...(guild.channels.cache?.values?.() || [])];
  const count = (...types) => channels.filter((c) => types.includes(c.type)).length;
  const embed = embeds.baseEmbed().setTitle(guild.name);
  if (guild.iconURL) embed.setThumbnail(guild.iconURL({ size: 256 }));
  embed.addFields(
    { name: 'Владелец', value: `<@${guild.ownerId}>`, inline: true },
    { name: 'ID', value: guild.id, inline: true },
    { name: 'Создан', value: `<t:${unix(guild.createdTimestamp)}:D> (<t:${unix(guild.createdTimestamp)}:R>)` },
    { name: 'Участников', value: String(guild.memberCount ?? '—'), inline: true },
    { name: 'Ролей', value: String(guild.roles?.cache?.size ?? '—'), inline: true },
    { name: 'Эмодзи', value: String(guild.emojis?.cache?.size ?? 0), inline: true },
    { name: 'Каналы', value: `Текстовых: ${count(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)}\nГолосовых: ${count(ChannelType.GuildVoice, ChannelType.GuildStageVoice)}\nКатегорий: ${count(ChannelType.GuildCategory)}`, inline: true },
    { name: 'Бусты', value: `Уровень ${guild.premiumTier ?? 0} · ${guild.premiumSubscriptionCount ?? 0} бустов`, inline: true },
    { name: 'Проверка', value: VERIFICATION[guild.verificationLevel] ?? String(guild.verificationLevel ?? '—'), inline: true }
  );
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = {
  variants: [
    {
      sub: 'userinfo',
      data: new SlashCommandBuilder().setName('userinfo').setDescription('Информация об участнике: даты, роли')
        .addUserOption((o) => o.setName('user').setDescription('О ком (по умолчанию — о вас)'))
    },
    { sub: 'serverinfo', data: new SlashCommandBuilder().setName('serverinfo').setDescription('Информация о сервере: участники, каналы, бусты') }
  ],
  data: new SlashCommandBuilder().setName('info').setDescription('Информация')
    .addSubcommand((s) => s.setName('userinfo').setDescription('Об участнике').addUserOption((o) => o.setName('user').setDescription('О ком')))
    .addSubcommand((s) => s.setName('serverinfo').setDescription('О сервере')),
  async execute(interaction) {
    return interaction.options.getSubcommand() === 'serverinfo' ? serverInfo(interaction) : userInfo(interaction);
  }
};
