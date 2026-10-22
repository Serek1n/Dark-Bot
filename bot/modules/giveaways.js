// Giveaways: a button to enter, a timer, and a random pick of winners when the time is up.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { Giveaway, GiveawayEntry } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { createScheduler, poke: pokeScheduler } = require('../utils/scheduler');
const { withLock } = require('../utils/lock');
const { isEnabled } = require('../utils/features');
const { getOrCreateSettings } = require('./leveling');

const PREFIX = 'gw:';
const parseWinners = (g) => { try { const v = JSON.parse(g.winners || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

function joinRow(giveaway, count = 0, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${giveaway.id}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎉')
      .setLabel(disabled ? 'Завершён' : count ? `Участвовать (${count})` : 'Участвовать')
      .setDisabled(disabled)
  );
}

function giveawayEmbed(giveaway, { count = 0, winnerIds = null } = {}) {
  const ended = Boolean(giveaway.ended);
  const embed = embeds.baseEmbed(ended ? embeds.COLORS.neutral : embeds.COLORS.primary).setTitle(`🎉 ${giveaway.prize}`);
  const lines = [];
  if (ended) {
    lines.push(winnerIds?.length ? `**Победител${winnerIds.length > 1 ? 'и' : 'ь'}:** ${winnerIds.map((id) => `<@${id}>`).join(', ')}` : '**Победителя нет:** никто не участвовал.');
    lines.push(`Завершён <t:${unix(giveaway.endsAt)}:R>`);
  } else {
    lines.push('Нажмите на кнопку ниже, чтобы участвовать. Нажмите ещё раз, чтобы выйти.');
    lines.push(`Закончится: <t:${unix(giveaway.endsAt)}:R> (<t:${unix(giveaway.endsAt)}:f>)`);
  }
  lines.push(`Победителей: **${giveaway.winnersCount}**`);
  if (giveaway.requiredRoleId) lines.push(`Нужна роль: <@&${giveaway.requiredRoleId}>`);
  lines.push(`Организатор: <@${giveaway.hostId}>`);
  if (!ended && count) lines.push(`Участников: **${count}**`);
  return embed.setDescription(lines.join('\n')).setFooter({ text: `Розыгрыш №${giveaway.id}` });
}

/** Random pick without repeats (crypto, so nobody can predict it). */
function pickWinners(ids, n) {
  const pool = [...ids];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return out;
}

async function startGiveaway(interaction, { prize, durationMs, winners, roleId }) {
  const giveaway = await Giveaway.create({
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    hostId: interaction.user.id,
    prize,
    winnersCount: winners,
    requiredRoleId: roleId || null,
    endsAt: new Date(Date.now() + durationMs)
  });
  const message = await interaction.channel.send({ embeds: [giveawayEmbed(giveaway)], components: [joinRow(giveaway)], allowedMentions: { parse: [] } });
  giveaway.messageId = message.id;
  await giveaway.save();
  pokeScheduler('giveaways'); // wake the scheduler: this one may end sooner than anything it was waiting for
  return giveaway;
}

/** Ends a giveaway (or re-draws winners of an ended one) and announces the result. Safe to call twice. */
async function finishGiveaway(client, giveaway, { reroll = false } = {}) {
  return withLock(`giveaway:${giveaway.id}`, async () => {
    await giveaway.reload();
    if (giveaway.ended && !reroll) return null;

    const guild = client.guilds?.cache?.get(giveaway.guildId) || (await client.guilds?.fetch?.(giveaway.guildId).catch(() => null));
    const entries = await GiveawayEntry.findAll({ where: { giveawayId: giveaway.id } });
    let ids = entries.map((e) => e.userId);
    if (reroll) ids = ids.filter((id) => !parseWinners(giveaway).includes(id));

    // Only people who are still on the server (and still have the required role) can win.
    const eligible = [];
    for (const id of ids) {
      const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
      if (!member) continue;
      if (giveaway.requiredRoleId && !member.roles?.cache?.has?.(giveaway.requiredRoleId)) continue;
      eligible.push(id);
    }
    const winnerIds = pickWinners(eligible, giveaway.winnersCount);

    giveaway.ended = true;
    giveaway.winners = JSON.stringify(winnerIds);
    await giveaway.save();

    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) {
      const original = giveaway.messageId ? await channel.messages?.fetch?.(giveaway.messageId).catch(() => null) : null;
      await original?.edit?.({ embeds: [giveawayEmbed(giveaway, { winnerIds })], components: [joinRow(giveaway, 0, true)] }).catch(() => {});
      const text = winnerIds.length
        ? `🎉 Поздравляем, ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Вы выиграли **${giveaway.prize}**.`
        : `Розыгрыш «${giveaway.prize}» закончился без победителя: подходящих участников нет.`;
      await channel.send({ content: text, allowedMentions: { users: winnerIds }, reply: original ? { messageReference: original.id, failIfNotExists: false } : undefined }).catch(() => {});
    }
    return winnerIds;
  });
}

const isGiveawayButton = (i) => i.isButton?.() && i.customId?.startsWith(PREFIX);

async function handleGiveawayButton(interaction) {
  const id = Number(interaction.customId.slice(PREFIX.length));
  const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  const giveaway = Number.isInteger(id) ? await Giveaway.findByPk(id) : null;
  if (!giveaway || giveaway.guildId !== interaction.guildId) return reply(embeds.error('Этот розыгрыш не найден.'));
  if (!isEnabled(await getOrCreateSettings(interaction.guildId), 'giveaways')) return reply(embeds.info('Розыгрыши на этом сервере отключены.'));
  if (giveaway.ended || new Date(giveaway.endsAt) <= new Date()) return reply(embeds.info('Этот розыгрыш уже закончился.'));
  if (giveaway.requiredRoleId && !interaction.member?.roles?.cache?.has?.(giveaway.requiredRoleId)) {
    return reply(embeds.error(`Чтобы участвовать, нужна роль <@&${giveaway.requiredRoleId}>.`));
  }

  const where = { giveawayId: giveaway.id, userId: interaction.user.id };
  const existing = await GiveawayEntry.findOne({ where });
  if (existing) await existing.destroy();
  else await GiveawayEntry.findOrCreate({ where });
  const count = await GiveawayEntry.count({ where: { giveawayId: giveaway.id } });

  await reply(existing ? embeds.info('Вы вышли из розыгрыша.') : embeds.success('Вы участвуете в розыгрыше. Удачи!'));
  // The counter on the button; skipped quietly if Discord says "slow down".
  await interaction.message?.edit?.({ embeds: [giveawayEmbed(giveaway, { count })], components: [joinRow(giveaway, count)] }).catch(() => {});
}

async function tick(client) {
  const due = await Giveaway.findAll({ where: { ended: false }, order: [['endsAt', 'ASC']], limit: 50 });
  for (const g of due) {
    if (new Date(g.endsAt) > new Date()) continue;
    try {
      await finishGiveaway(client, g);
    } catch (err) {
      logger.error(`Giveaway ${g.id} could not be finished:`, err.message);
    }
  }
}

let scheduler = null;
function startGiveawayScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'giveaways', nextDue: () => Giveaway.min('endsAt', { where: { ended: false } }), run: () => tick(client) }).start();
}

module.exports = { startGiveaway, finishGiveaway, giveawayEmbed, pickWinners, isGiveawayButton, handleGiveawayButton, startGiveawayScheduler, tick, parseWinners };
