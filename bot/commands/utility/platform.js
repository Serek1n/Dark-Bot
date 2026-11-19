// /platform — for the owners of the DARK platform: what waits for a decision (communities sent for review, complaints,
// reviews with complaints) and a link to the page «Платформа DARK» where it is decided. Everyone else is told it is not theirs.
const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const coins = require('../../modules/darkCoins');
const cm = require('../../modules/communities');

module.exports = {
  data: new SlashCommandBuilder().setName('platform').setDescription('Платформа DARK: очередь модерации каталога (для владельцев платформы)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!coins.isPlatformOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [embeds.error('Эта команда — только для владельцев платформы DARK.')], flags: MessageFlags.Ephemeral });
    }
    const q = await cm.queue();
    const waiting = await require('../../../db').Community.findAll({ where: { status: 'pending' }, order: [['id', 'ASC']], limit: 10, raw: true });
    const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
    const list = waiting.map((c) => `• ${base ? `[${c.name}](${base}/communities/${c.id})` : `**${c.name}**`} — сервер \`${c.guildId}\``).join('\n');
    const e = new EmbedBuilder().setColor(0x8b7cf6).setTitle('Платформа DARK')
      .setDescription(q.total ? `Ждут решения: **${q.total}**` : 'Очередь пуста: новых заявок и жалоб нет.')
      .addFields(
        { name: 'На проверке', value: String(q.pending), inline: true },
        { name: 'Жалобы на сообщества', value: String(q.reports), inline: true },
        { name: 'Отзывы с жалобами', value: String(q.reviews), inline: true }
      );
    if (list) e.addFields({ name: 'Сообщества на проверке', value: list.slice(0, 1024) });
    const reply = { embeds: [e], flags: MessageFlags.Ephemeral };
    if (base) reply.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Открыть модерацию').setURL(`${base}/platform#moderation`))];
    else e.setFooter({ text: 'WEB_BASE_URL не задан — откройте /platform на сайте панели' });
    return interaction.reply(reply);
  }
};
