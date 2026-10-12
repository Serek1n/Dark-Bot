const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { MemberProfile } = require('../../db');
const { Op } = require('sequelize');
const { renderLeaderboard } = require('./rankCard');
const embeds = require('../utils/embeds');
const { formatDuration } = require('./voiceTime');
const logger = require('../utils/logger');

const PAGE_SIZE = 10;
const PREFIX = 'top';
const CATS = { total: { field: 'xp', label: 'Общий', heading: 'Таблица лидеров' }, voice: { field: 'voiceXp', label: 'Голос', heading: 'Лидеры голоса' } };
const catOf = (c) => (CATS[c] ? c : 'total');

function navRow(page, pages, userId, cat) {
  // Discord requires every custom_id in a message to be unique, so the action name is part of it
  // (otherwise "first" and "previous" both point to page 0 on the second page, and the edit is rejected).
  const btn = (action, target, label, disabled) =>
    new ButtonBuilder().setCustomId(`${PREFIX}:${action}:${Math.max(0, target)}:${userId}:${cat}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const indicator = new ButtonBuilder()
    .setCustomId(`${PREFIX}:noop:0:${userId}:${cat}`)
    .setLabel(`${page + 1} / ${pages}`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);
  return new ActionRowBuilder().addComponents(
    btn('first', 0, '⏮', page === 0),
    btn('prev', page - 1, '◀', page === 0),
    indicator,
    btn('next', Math.min(page + 1, pages - 1), '▶', page >= pages - 1),
    btn('last', pages - 1, '⏭', page >= pages - 1)
  );
}

function catRow(active, userId) {
  return new ActionRowBuilder().addComponents(
    ...Object.entries(CATS).map(([key, c]) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:cat:0:${userId}:${key}`)
        .setLabel(c.label)
        .setStyle(key === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(key === active)
    )
  );
}

/** Builds one page of the leaderboard: PNG + navigation buttons (or an embed if drawing fails). */
async function buildTopPage(client, guild, requestedPage, userId, category = 'total') {
  const cat = catOf(category);
  const c = CATS[cat];
  const where = cat === 'total' ? { guildId: guild.id } : { guildId: guild.id, [c.field]: { [Op.gt]: 0 } };
  const total = await MemberProfile.count({ where });
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(Number(requestedPage)) || 0));

  const profiles = await MemberProfile.findAll({
    where,
    order: [[c.field, 'DESC'], ['id', 'ASC']],
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });
  const components = [...(pages > 1 ? [navRow(page, pages, userId, cat)] : []), catRow(cat, userId)];

  try {
    const rows = await Promise.all(
      profiles.map(async (p, i) => {
        const user = await client.users.fetch(p.userId).catch(() => null);
        return {
          rank: page * PAGE_SIZE + i + 1,
          name: user ? user.globalName || user.username : `Участник ${String(p.userId).slice(-4)}`,
          avatarURL: user ? user.displayAvatarURL({ extension: 'png', size: 64 }) : null,
          level: p.level,
          xp: Number(p[c.field]),
          sub: cat === 'voice' ? formatDuration(p.voiceSeconds) : null
        };
      })
    );
    const png = await renderLeaderboard({ heading: c.heading, title: guild.name, rows, page: page + 1, pages });
    return { files: [new AttachmentBuilder(png, { name: `top-${page + 1}.png` })], embeds: [], components };
  } catch (err) {
    logger.error('Failed to render leaderboard, falling back to embed:', err);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = profiles.map((p, i) => {
      const rank = page * PAGE_SIZE + i + 1;
      return `${medals[rank - 1] || `**${rank}.**`}  <@${p.userId}>  —  уровень ${p.level} · ${p[c.field]} XP`;
    });
    return {
      files: [],
      embeds: [embeds.baseEmbed().setTitle(c.heading).setDescription(lines.join('\n')).setFooter({ text: `Страница ${page + 1} из ${pages}` })],
      components
    };
  }
}

function isTopButton(interaction) {
  return interaction.isButton?.() && String(interaction.customId).startsWith(`${PREFIX}:`);
}

async function handleTopButton(interaction) {
  const [, action, target, ownerId, category] = String(interaction.customId).split(':');
  if (action === 'noop') return interaction.deferUpdate();
  if (ownerId && interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [embeds.info('Это таблица другого участника. Откройте свою: `/top`.')], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const payload = await buildTopPage(interaction.client, interaction.guild, action === 'cat' ? 0 : target, interaction.user.id, category);
  if (!payload) return;
  await interaction.editReply({ ...payload, attachments: [] }).catch((err) => logger.error('Leaderboard page update failed:', err));
}

module.exports = { buildTopPage, isTopButton, handleTopButton, PAGE_SIZE };
