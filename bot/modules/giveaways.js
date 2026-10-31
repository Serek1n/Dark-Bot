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

const { credit } = require('./wallet');
const { canSelfGive } = require('../utils/safeRole');
const { formatTerm } = require('../utils/duration');

const PREFIX = 'gw:';
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const parseIds = (text) => { try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** "1 000 монет", "роль @VIP на 7 д" — what the bot gives each winner, or null. Names come from the server's settings. */
function rewardText(giveaway, settings = {}) {
  if (giveaway.rewardType === 'coins') return `${fmt(giveaway.rewardAmount)} ${settings.currencyName || 'монет'}`;
  if (giveaway.rewardType === 'crystals') return `${fmt(giveaway.rewardAmount)} ${settings.crystalName || 'кристаллов'}`;
  if (giveaway.rewardType === 'role') return `роль <@&${giveaway.rewardRoleId}>${giveaway.rewardSeconds ? ` на ${formatTerm(giveaway.rewardSeconds * 1000)}` : ''}`;
  return null;
}

/**
 * Hands the prize to the winners who have not got it yet. Returns { given: [ids], failed: [ids] }. Never throws.
 * A role is checked at this moment again (it may have got admin rights since the start) and is given for a while when set.
 */
async function grantRewards(guild, giveaway, winnerIds) {
  const out = { given: [], failed: [] };
  if (!giveaway.rewardType || !winnerIds.length) return out;
  const done = new Set(parseIds(giveaway.rewarded));
  const role = giveaway.rewardType === 'role' ? guild?.roles?.cache?.get(giveaway.rewardRoleId) : null;
  for (const id of winnerIds) {
    if (done.has(id)) continue;
    try {
      if (giveaway.rewardType === 'coins' || giveaway.rewardType === 'crystals') {
        await credit(giveaway.guildId, id, giveaway.rewardType === 'coins' ? 'balance' : 'crystals', giveaway.rewardAmount);
      } else if (giveaway.rewardType === 'role') {
        if (!role || !canSelfGive(role, guild)) throw new Error('роль недоступна');
        const member = await guild.members.fetch(id);
        const reason = `Приз розыгрыша №${giveaway.id}`;
        if (giveaway.rewardSeconds > 0) await require('./tempRoles').giveOrExtend(guild, member, role.id, giveaway.rewardSeconds * 1000, `giveaway:${giveaway.id}`, reason);
        else await member.roles.add(role, reason);
      } else continue;
      done.add(id); out.given.push(id);
    } catch (err) {
      logger.warn(`Giveaway ${giveaway.id} prize for ${id}: ${err.message}`);
      out.failed.push(id);
    }
  }
  giveaway.rewarded = JSON.stringify([...done]);
  await giveaway.save().catch(() => {});
  return out;
}
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

function giveawayEmbed(giveaway, { count = 0, winnerIds = null, settings = {} } = {}) {
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
  const reward = rewardText(giveaway, settings);
  if (reward) lines.push(`Приз выдаётся сразу: **${reward}** каждому победителю`);
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

async function startGiveaway(interaction, { prize, durationMs, winners, roleId, reward = null, channel = null }) {
  const target = channel || interaction.channel;
  const giveaway = await Giveaway.create({
    guildId: interaction.guild.id,
    channelId: target.id || interaction.channelId,
    hostId: interaction.user.id,
    prize,
    winnersCount: winners,
    requiredRoleId: roleId || null,
    endsAt: new Date(Date.now() + durationMs),
    rewardType: reward?.type || null,
    rewardAmount: reward?.amount || null,
    rewardRoleId: reward?.roleId || null,
    rewardSeconds: reward?.seconds || null
  });
  const settings = reward ? await getOrCreateSettings(interaction.guild.id).catch(() => ({})) : {};
  const message = await target.send({ embeds: [giveawayEmbed(giveaway, { settings })], components: [joinRow(giveaway)], allowedMentions: { parse: [] } });
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

    // Only people who are still on the server (and still have the required role) can win. Entries are drawn in
    // random order and checked one by one until there are enough winners: with thousands of entries only a handful
    // of members are asked from Discord, not every one of them.
    const winnerIds = [];
    for (const id of pickWinners(ids, ids.length)) {
      if (winnerIds.length >= giveaway.winnersCount) break;
      const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
      if (!member) continue;
      if (giveaway.requiredRoleId && !member.roles?.cache?.has?.(giveaway.requiredRoleId)) continue;
      winnerIds.push(id);
    }

    giveaway.ended = true;
    giveaway.winners = JSON.stringify(winnerIds);
    const pendingEdit = counterEdits.get(giveaway.id); // no counter refresh after the end
    if (pendingEdit?.timer) clearTimeout(pendingEdit.timer);
    counterEdits.delete(giveaway.id);
    await giveaway.save();

    const settings = giveaway.rewardType ? await getOrCreateSettings(giveaway.guildId).catch(() => ({})) : {};
    const paid = await grantRewards(guild, giveaway, winnerIds);
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) {
      const original = giveaway.messageId ? await channel.messages?.fetch?.(giveaway.messageId).catch(() => null) : null;
      await original?.edit?.({ embeds: [giveawayEmbed(giveaway, { winnerIds, settings })], components: [joinRow(giveaway, 0, true)] }).catch(() => {});
      let text = winnerIds.length
        ? `🎉 Поздравляем, ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Вы выиграли **${giveaway.prize}**.`
        : `Розыгрыш «${giveaway.prize}» закончился без победителя: подходящих участников нет.`;
      if (paid.given.length) text += `\n🎁 Уже начислено: ${rewardText(giveaway, settings)}${paid.given.length < winnerIds.length ? ` (${paid.given.map((id) => `<@${id}>`).join(', ')})` : ''}.`;
      if (paid.failed.length) text += `\n⚠️ Не удалось выдать приз: ${paid.failed.map((id) => `<@${id}>`).join(', ')} — администрация выдаст вручную.`;
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

  await reply(existing ? embeds.info('Вы вышли из розыгрыша.') : embeds.success('Вы участвуете в розыгрыше. Удачи!'));
  scheduleCounterEdit(giveaway, interaction.message);
}

// The counter on the button is refreshed at most once per 5 s per giveaway: hundreds of clicks must not mean
// hundreds of message edits (Discord would start refusing them).
const COUNTER_EDIT_MS = 5000;
const counterEdits = new Map(); // giveaway id -> { timer, lastAt }
function scheduleCounterEdit(giveaway, message) {
  if (!message?.edit) return;
  const state = counterEdits.get(giveaway.id) || { timer: null, lastAt: 0 };
  counterEdits.set(giveaway.id, state);
  if (state.timer) return; // an edit is already planned; it will read the fresh count
  const run = async () => {
    state.timer = null;
    state.lastAt = Date.now();
    const count = await GiveawayEntry.count({ where: { giveawayId: giveaway.id } }).catch(() => null);
    const settings = giveaway.rewardType ? await getOrCreateSettings(giveaway.guildId).catch(() => ({})) : {};
    if (count !== null) await message.edit({ embeds: [giveawayEmbed(giveaway, { count, settings })], components: [joinRow(giveaway, count)] }).catch(() => {});
  };
  const wait = Math.max(0, state.lastAt + COUNTER_EDIT_MS - Date.now());
  if (!wait) return run();
  state.timer = setTimeout(run, wait);
  state.timer.unref?.();
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

module.exports = { startGiveaway, finishGiveaway, giveawayEmbed, grantRewards, rewardText, pickWinners, isGiveawayButton, handleGiveawayButton, startGiveawayScheduler, tick, parseWinners };
