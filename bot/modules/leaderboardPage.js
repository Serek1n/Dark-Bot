const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { MemberProfile } = require('../../db');
const { Op } = require('sequelize');
const { renderLeaderboard } = require('./rankCard');
const embeds = require('../utils/embeds');
const { formatDuration } = require('./voiceTime');
const logger = require('../utils/logger');

const PAGE_SIZE = 10;
const PREFIX = 'top';
const CATS = { total: { field: 'xp', label: 'Общий', heading: 'Таблица лидеров' }, voice: { field: 'voiceSeconds', label: 'Голос', heading: 'Лидеры голоса' } };
const catOf = (c) => (CATS[c] ? c : 'total');

// Speed: the picture costs ~150 ms to encode, Discord lookups of names cost more. So
//  • a page whose content has not changed is not drawn again (the same rows → the same PNG, kept 2 minutes);
//  • after a page is shown, the next one is prepared in the background, so "▶" answers at once;
//  • names and avatars come from the server's member cache, Discord is asked only for people not in it;
//  • the number of ranked members is remembered for 15 seconds (it changes rarely and is asked on every click).
const PNG_TTL_MS = 2 * 60_000;
const PNG_MAX = 60;
const COUNT_TTL_MS = 15_000;
const pngCache = new Map(); // guild:cat:page:lang -> { sig, png, expires }
const countCache = new Map(); // guild:cat -> { n, expires }

function remember(map, key, value, max) {
  map.delete(key); map.set(key, value);
  if (map.size > max) for (const [k, v] of map) { if (map.size <= max && v.expires > Date.now()) break; map.delete(k); }
}

async function rankedCount(guildId, cat, where) {
  const key = `${guildId}:${cat}`; const hit = countCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.n;
  const n = await MemberProfile.count({ where });
  remember(countCache, key, { n, expires: Date.now() + COUNT_TTL_MS }, 500);
  return n;
}

/** Name and avatar of a member: from the server's cache when possible, Discord is asked only otherwise. */
async function personOf(client, guild, userId) {
  const m = guild.members?.cache?.get?.(userId);
  if (m) return { name: m.displayName || m.user?.globalName || m.user?.username, avatarURL: m.displayAvatarURL?.({ extension: 'png', size: 64 }) || m.user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || null };
  const user = client.users?.cache?.get?.(userId) || (await client.users.fetch(userId).catch(() => null));
  return user ? { name: user.globalName || user.username, avatarURL: user.displayAvatarURL({ extension: 'png', size: 64 }) } : null;
}

/** Forgets the drawn pages of a server (tests, or after levels were changed by hand). */
function forgetPages(guildId) { for (const k of pngCache.keys()) if (!guildId || k.startsWith(`${guildId}:`)) pngCache.delete(k); for (const k of countCache.keys()) if (!guildId || k.startsWith(`${guildId}:`)) countCache.delete(k); }

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
async function buildTopPage(client, guild, requestedPage, userId, category = 'total', { prefetch = true } = {}) {
  const cat = catOf(category);
  const c = CATS[cat];
  const where = cat === 'total' ? { guildId: guild.id } : { guildId: guild.id, [c.field]: { [Op.gt]: 0 } };
  const total = await rankedCount(guild.id, cat, where);
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(Number(requestedPage)) || 0));

  const profiles = await MemberProfile.findAll({
    where,
    attributes: ['userId', 'level', 'xp', 'voiceSeconds'],
    order: [[c.field, 'DESC'], ['id', 'ASC']],
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    raw: true
  });
  const components = [...(pages > 1 ? [navRow(page, pages, userId, cat)] : []), catRow(cat, userId)];

  try {
    const rows = await Promise.all(
      profiles.map(async (p, i) => {
        const who = await personOf(client, guild, p.userId);
        return {
          rank: page * PAGE_SIZE + i + 1,
          name: who?.name || `Участник ${String(p.userId).slice(-4)}`,
          avatarURL: who?.avatarURL || null,
          level: p.level,
          xp: Number(p[c.field]),
          // The voice board ranks by hours spent in voice (the same number as on the profile card).
          sub: cat === 'voice' ? formatDuration(p.voiceSeconds) : null,
          small: cat === 'voice' ? `ур. ${p.level}` : null
        };
      })
    );
    const data = { heading: c.heading, title: guild.name, rows, page: page + 1, pages };
    const key = `${guild.id}:${cat}:${page}:${require('../../i18n').currentLang()}`;
    const sig = JSON.stringify(data);
    const hit = pngCache.get(key);
    let png;
    if (hit && hit.sig === sig && hit.expires > Date.now()) png = hit.png; // nothing changed on this page: the same picture
    else {
      png = await renderLeaderboard(data);
      remember(pngCache, key, { sig, png, expires: Date.now() + PNG_TTL_MS }, PNG_MAX);
    }
    // the next page is drawn while the person looks at this one
    if (prefetch && page + 1 < pages) setImmediate(() => buildTopPage(client, guild, page + 1, userId, cat, { prefetch: false }).catch(() => {}));
    return { files: [new AttachmentBuilder(png, { name: `top-${page + 1}.png` })], embeds: [], components };
  } catch (err) {
    logger.error('Failed to render leaderboard, falling back to embed:', err);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = profiles.map((p, i) => {
      const rank = page * PAGE_SIZE + i + 1;
      return `${medals[rank - 1] || `**${rank}.**`}  <@${p.userId}>  —  уровень ${p.level} · ${cat === 'voice' ? formatDuration(p.voiceSeconds) : p.xp + ' XP'}`;
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

module.exports = { buildTopPage, isTopButton, handleTopButton, forgetPages, personOf, PAGE_SIZE };
