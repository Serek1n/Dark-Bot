// /vote — the server's card in the catalog «Сообщества DARK» right in Discord: members, votes, marks, and a button to vote
// without opening the site (the same rules: once in 12 hours, a Discord account older than 7 days).
const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const cm = require('../../modules/communities');

const f = (n) => Number(n || 0).toLocaleString('ru-RU');

module.exports = {
  data: new SlashCommandBuilder().setName('vote').setDescription('Проголосовать за сервер в каталоге «Сообщества DARK»'),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [embeds.error('Эта команда работает только на сервере.')], flags: MessageFlags.Ephemeral });
    const c = await cm.forGuild(interaction.guild.id);
    if (!c) return interaction.reply({ embeds: [embeds.info('Этого сервера нет в каталоге «Сообщества DARK». Администратор может добавить его в панели: «Сообщество в каталоге».')], flags: MessageFlags.Ephemeral });
    return interaction.reply({ ...card(c), flags: MessageFlags.Ephemeral });
  },
  card
};

function card(c) {
  const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const e = new EmbedBuilder().setColor(0x8b7cf6).setTitle(c.name).setDescription(c.shortDesc)
    .addFields(
      { name: 'Участников', value: f(c.memberCount), inline: true },
      { name: 'Голосов', value: f(c.votes), inline: true },
      { name: 'Оценка', value: c.rating === null ? 'нет отзывов' : `★ ${String(c.rating).replace('.', ',')} (${f(c.ratingCount)})`, inline: true }
    )
    .setFooter({ text: 'Голосовать можно раз в 12 часов' });
  if (c.icon) e.setThumbnail(c.icon);
  if (base) e.setURL(`${base}/communities/${c.id}`);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cmvote:${c.id}`).setLabel('Проголосовать').setEmoji('🔼').setStyle(ButtonStyle.Primary));
  if (base) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Отзывы и страница').setURL(`${base}/communities/${c.id}#reviews`));
  return { embeds: [e], components: [row] };
}
