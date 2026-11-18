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
 * Coins and crystals: the payment and the mark «this one is paid» are ONE transaction, and the list of who is paid is read
 * inside it — a crash in the middle, a second call at the same time or a restart can never pay a winner twice.
 * A role is checked at this moment again (it may have got admin rights since the start) and is given for a while when set;
 * the mark is saved right after each role, not once at the end.
 */
async function grantRewards(guild, giveaway, winnerIds) {
  const out = { given: [], failed: [] };
  if (!giveaway.rewardType || !winnerIds.length) return out;
  const { inTransaction } = require('../../db');
  const role = giveaway.rewardType === 'role' ? guild?.roles?.cache?.get(giveaway.rewardRoleId) : null;
  for (const id of winnerIds) {
    try {
      if (giveaway.rewardType === 'coins' || giveaway.rewardType === 'crystals') {
        const paid = await inTransaction(async (t) => {
          const fresh = await Giveaway.findByPk(giveaway.id, { transaction: t });
          const done = new Set(parseIds(fresh?.rewarded));
          if (done.has(id)) return false;
          await require('./econ/ledger').give(giveaway.guildId, id, giveaway.rewardType === 'coins' ? 'balance' : 'crystals', giveaway.rewardAmount, 'giveaway', { note: `#${giveaway.id}` }, t);
          done.add(id);
          await fresh.update({ rewarded: JSON.stringify([...done]) }, { transaction: t });
          giveaway.rewarded = fresh.rewarded;
          return true;
        });
        if (paid) out.given.push(id);
      } else if (giveaway.rewardType === 'role') {
        if (parseIds(giveaway.rewarded).includes(id)) continue;
        if (!role || !canSelfGive(role, guild)) throw new Error('роль недоступна');
        const member = await guild.members.fetch(id);
        const reason = `Приз розыгрыша №${giveaway.id}`;
        if (giveaway.rewardSeconds > 0) await require('./tempRoles').giveOrExtend(guild, member, role.id, giveaway.rewardSeconds * 1000, `giveaway:${giveaway.id}`, reason);
        else await member.roles.add(role, reason);
        giveaway.rewarded = JSON.stringify([...new Set([...parseIds(giveaway.rewarded), id])]);
        await giveaway.save();
        out.given.push(id);
      }
    } catch (err) {
      logger.warn(`Giveaway ${giveaway.id} prize for ${id}: ${err.message}`);
      out.failed.push(id);
    }
  }
  return out;
}

/**
 * A giveaway paid from the treasury took amount × places at the start. The places nobody won (too few entries) go back to
 * the treasury once, at the end. A winner whose payment failed keeps his place: it is paid on the next start (settleUnpaid).
 */
async function refundUnwon(giveaway) {
  if (giveaway.rewardSource !== 'treasury' || giveaway.rewardType !== 'coins' || giveaway.refunded) return 0;
  const empty = Math.max(0, Number(giveaway.winnersCount || 0) - parseWinners(giveaway).length);
  const { inTransaction } = require('../../db');
  return inTransaction(async (t) => {
    const fresh = await Giveaway.findByPk(giveaway.id, { transaction: t });
    if (!fresh || fresh.refunded) return 0;
    const back = empty * Number(fresh.rewardAmount || 0);
    if (back > 0) await require('./econ/ledger').treasuryAdd(fresh.guildId, back, t);
    await fresh.update({ refunded: true }, { transaction: t });
    giveaway.refunded = true;
    return back;
  });
}

/**
 * A re-draw of a giveaway with coins or crystals must not print money: the prize of a new winner is taken back from the
 * winner he replaces. Whoever has already spent it keeps it — and then that place stays without a new prize.
 * Returns how many prizes may be paid to new winners.
 */
async function reclaimForReroll(giveaway, oldWinners = parseWinners(giveaway)) {
  if (giveaway.rewardType !== 'coins' && giveaway.rewardType !== 'crystals') return Infinity; // roles: nothing is printed
  const ledger = require('./econ/ledger');
  const field = giveaway.rewardType === 'coins' ? 'balance' : 'crystals';
  const paid = parseIds(giveaway.rewarded);
  const unpaidPlaces = oldWinners.filter((id) => !paid.includes(id)).length;
  let freed = unpaidPlaces;
  const { inTransaction } = require('../../db');
  for (const id of paid) {
    const ok = await inTransaction(async (t) => {
      const fresh = await Giveaway.findByPk(giveaway.id, { transaction: t });
      const list = parseIds(fresh.rewarded);
      if (!list.includes(id)) return false;
      if ((await ledger.take(giveaway.guildId, id, field, giveaway.rewardAmount, 'giveaway', { note: `#${giveaway.id}: перевыбор` }, t)) === null) return false;
      await fresh.update({ rewarded: JSON.stringify(list.filter((x) => x !== id)) }, { transaction: t });
      giveaway.rewarded = fresh.rewarded;
      return true;
    });
    if (ok) freed++;
  }
  return freed;
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
    lines.push(winnerIds?.length ? `${winnerIds.length > 1 ? '**Победители:**' : '**Победитель:**'} ${winnerIds.map((id) => `<@${id}>`).join(', ')}` : '**Победителя нет:** никто не участвовал.');
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
  // reward.source 'treasury': the money was already taken from the treasury (bot/modules/econ/treasury.js)
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
    rewardSeconds: reward?.seconds || null,
    rewardSource: reward?.source || null
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
    const oldWinners = parseWinners(giveaway);
    if (reroll) ids = ids.filter((id) => !oldWinners.includes(id));

    // Only people who are still on the server (and still have the required role) can win. Entries are drawn in
    // random order and checked one by one until there are enough winners: with thousands of entries only a handful
    // of members are asked from Discord, not every one of them.
    const winnerIds = [];
    for (const id of pickWinners(ids, ids.length)) {
      if (winnerIds.length >= giveaway.winnersCount) break;
      // «left the server» only when Discord says so; a hiccup is asked once more, so a passing error does not cost a win
      const fetchMember = () => guild.members.fetch(id);
      const member = guild ? await fetchMember().catch((err) => (require('../utils/discordErrors').isGone(err) ? null : fetchMember().catch(() => null))) : null;
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
    let payable = winnerIds;
    if (reroll && winnerIds.length) { // the old winners give the prize back first; only that many new ones are paid
      const freed = await reclaimForReroll(giveaway, oldWinners).catch((err) => { logger.warn(`Giveaway ${giveaway.id} reroll reclaim: ${err.message}`); return 0; });
      payable = winnerIds.slice(0, freed);
    }
    const paid = await grantRewards(guild, giveaway, payable);
    paid.notPaid = winnerIds.filter((id) => !payable.includes(id));
    if (!reroll) await refundUnwon(giveaway).catch((err) => logger.warn(`Giveaway ${giveaway.id} refund: ${err.message}`));
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) {
      const original = giveaway.messageId ? await channel.messages?.fetch?.(giveaway.messageId).catch(() => null) : null;
      await original?.edit?.({ embeds: [giveawayEmbed(giveaway, { winnerIds, settings })], components: [joinRow(giveaway, 0, true)] }).catch(() => {});
      let text = winnerIds.length
        ? `🎉 Поздравляем, ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Вы выиграли **${giveaway.prize}**.`
        : `Розыгрыш «${giveaway.prize}» закончился без победителя: подходящих участников нет.`;
      if (paid.given.length) text += `\n🎁 Уже начислено: ${rewardText(giveaway, settings)}${paid.given.length < winnerIds.length ? ` (${paid.given.map((id) => `<@${id}>`).join(', ')})` : ''}.`;
      if (paid.failed.length) text += `\n⚠️ Не удалось выдать приз: ${paid.failed.map((id) => `<@${id}>`).join(', ')} — администрация выдаст вручную.`;
      if (paid.notPaid.length) text += `\nℹ️ Без приза: ${paid.notPaid.map((id) => `<@${id}>`).join(', ')} — прежний победитель уже потратил его, а новых монет перевыбор не создаёт.`;
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
  else {
    await GiveawayEntry.findOrCreate({ where });
    require('./achievements').touch(interaction.guildId, interaction.user.id, { channel: interaction.channel }); // «Участник» — an event
  }

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

/** At start: giveaways that ended within the last day but whose prizes were not (all) given, because the process
 *  stopped between "ended" and the prizes. grantRewards skips whoever already has his prize. */
async function settleUnpaid(client) {
  const { Op } = require('sequelize');
  const rows = await Giveaway.findAll({ where: { ended: true, rewardType: { [Op.ne]: null }, endsAt: { [Op.gte]: new Date(Date.now() - 24 * 3600 * 1000) } }, limit: 100 });
  for (const g of rows) {
    const winners = parseIds(g.winners); const paid = new Set(parseIds(g.rewarded));
    if (g.rewardSource === 'treasury' && !g.refunded) await refundUnwon(g).catch(() => {}); // stopped before the refund
    if (!winners.length || winners.every((id) => paid.has(id))) continue;
    const guild = client.guilds.cache.get(g.guildId);
    if (!guild) continue;
    await grantRewards(guild, g, winners).catch((err) => logger.warn(`giveaway ${g.id}: prizes after restart failed: ${err.message}`));
  }
}

module.exports = { settleUnpaid, refundUnwon, reclaimForReroll, startGiveaway, finishGiveaway, giveawayEmbed, grantRewards, rewardText, pickWinners, isGiveawayButton, handleGiveawayButton, startGiveawayScheduler, tick, parseWinners };
