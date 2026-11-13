// Сделки с гарантом: /deal @user 500 «нарисую аватар». The buyer's money is frozen at once; the seller accepts or declines; when both
// press «Выполнено» the money goes to the seller (minus the treasury's deal tax). If they disagree, «Спор» calls a moderator, who
// gives the money to one of them. A deal nobody accepted in time goes back to the buyer.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { Op } = require('sequelize');
const { inTransaction, EconomyDeal, GuildSettings } = require('../../../db');
const embeds = require('../../utils/embeds');
const config = require('./config');
const ledger = require('./ledger');
const wallet = require('../wallet');

const PREFIX = 'edeal';
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const STATUS = { pending: 'Ждёт, когда продавец примет', active: 'В работе', disputed: 'Спор — решает модератор', done: 'Завершена: деньги у продавца', refunded: 'Деньги вернулись покупателю' };

function view(deal, settings) {
  const cur = settings?.currencyName || 'монеты';
  const marks = deal.status === 'active' ? `\nПокупатель: ${deal.buyerDone ? '✓ выполнено' : '…'} · Продавец: ${deal.sellerDone ? '✓ выполнено' : '…'}` : '';
  const color = deal.status === 'done' ? embeds.COLORS.success : deal.status === 'refunded' ? embeds.COLORS.danger : embeds.COLORS.neutral;
  const embed = embeds.baseEmbed(color).setTitle(`Сделка №${deal.id}: ${deal.title}`)
    .setDescription(`Покупатель <@${deal.buyerId}> → продавец <@${deal.sellerId}>\nСумма: **${fmt(deal.amount)} ${cur}** — заморожена у бота\n\n**${STATUS[deal.status] || deal.status}**${deal.outcome ? `\n${deal.outcome}` : ''}${marks}${deal.status === 'pending' && deal.expiresAt ? `\nПринять до <t:${unix(deal.expiresAt)}:f>` : ''}`);
  const b = (action, label, style) => new ButtonBuilder().setCustomId(`${PREFIX}:${action}:${deal.id}`).setLabel(label).setStyle(style);
  const rows = [];
  if (deal.status === 'pending') rows.push(new ActionRowBuilder().addComponents(b('accept', 'Принять', ButtonStyle.Success), b('decline', 'Отклонить', ButtonStyle.Secondary), b('cancel', 'Отменить (покупатель)', ButtonStyle.Secondary)));
  if (deal.status === 'active') rows.push(new ActionRowBuilder().addComponents(b('done', 'Выполнено', ButtonStyle.Success), b('dispute', 'Спор', ButtonStyle.Danger)));
  if (deal.status === 'disputed') rows.push(new ActionRowBuilder().addComponents(b('toSeller', 'Деньги продавцу', ButtonStyle.Primary), b('toBuyer', 'Вернуть покупателю', ButtonStyle.Secondary)));
  return { embeds: [embed], components: rows, allowedMentions: { users: [deal.buyerId, deal.sellerId] } };
}

/** Opens a deal: freezes the buyer's money. Returns { deal } or { error: 'funds' }. */
async function open(settings, guildId, buyerId, sellerId, amount, title, channelId) {
  const hours = config.params(settings, 'deals').acceptHours;
  return inTransaction(async (t) => {
    if ((await wallet.spend(guildId, buyerId, 'balance', amount, t)) === null) return { error: 'funds' };
    const deal = await EconomyDeal.create({ guildId, buyerId, sellerId, amount, title: String(title).slice(0, 120), channelId, expiresAt: new Date(Date.now() + hours * 3600000) }, { transaction: t });
    await ledger.record({ guildId, userId: buyerId, amount: -amount, kind: 'deal_hold', otherId: sellerId, note: `#${deal.id}` }, t);
    return { deal };
  });
}

/** Ends a deal one way or the other, exactly once. to: 'seller' | 'buyer'. */
async function settle(deal, to, outcome, settings) {
  return inTransaction(async (t) => {
    const status = to === 'seller' ? 'done' : 'refunded';
    const [changed] = await EconomyDeal.update({ status, outcome }, { where: { id: deal.id, status: { [Op.in]: ['pending', 'active', 'disputed'] } }, transaction: t });
    if (!changed) return false;
    if (to === 'seller') {
      const tax = config.isOn(settings, 'treasury') ? ledger.percent(deal.amount, config.params(settings, 'treasury').dealTax) : 0;
      const got = deal.amount - tax;
      if (got > 0) await wallet.credit(deal.guildId, deal.sellerId, 'balance', got, t);
      if (tax > 0) await ledger.treasuryAdd(deal.guildId, tax, t);
      await ledger.record({ guildId: deal.guildId, userId: deal.sellerId, amount: got, kind: 'deal_in', otherId: deal.buyerId, note: tax ? `#${deal.id} tax:${tax}` : `#${deal.id}` }, t);
    } else {
      await wallet.credit(deal.guildId, deal.buyerId, 'balance', deal.amount, t);
      await ledger.record({ guildId: deal.guildId, userId: deal.buyerId, amount: deal.amount, kind: 'deal_refund', otherId: deal.sellerId, note: `#${deal.id}` }, t);
    }
    deal.status = status; deal.outcome = outcome;
    return true;
  });
}

async function refreshMessage(deal, settings) {
  const c = require('../../../web/botBridge').getClient?.();
  if (!c || !deal.channelId || !deal.messageId) return;
  const ch = c.channels.cache.get(deal.channelId) || (await c.channels.fetch(deal.channelId).catch(() => null));
  const msg = ch ? await ch.messages.fetch(deal.messageId).catch(() => null) : null;
  if (msg) await msg.edit(view(deal, settings)).catch(() => {});
}

/** Pending deals nobody accepted in time: back to the buyer. */
async function expireDue(now = new Date()) {
  const due = await EconomyDeal.findAll({ where: { status: 'pending', expiresAt: { [Op.lte]: now } }, limit: 50 });
  for (const d of due) {
    const settings = await GuildSettings.findOne({ where: { guildId: d.guildId } });
    if (await settle(d, 'buyer', 'Продавец не принял сделку вовремя.', settings)) await refreshMessage(d, settings);
  }
  return due.length;
}

const isModerator = (member) => !!member?.permissions?.has?.(PermissionFlagsBits.ModerateMembers) || !!member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);
const isDealComponent = (i) => typeof i.customId === 'string' && i.customId.startsWith(`${PREFIX}:`);

async function handleDealComponent(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const settings = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
  const deal = await EconomyDeal.findOne({ where: { id: Number(id), guildId: interaction.guildId } });
  const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
  if (!deal) return deny('Сделка не найдена.');
  const me = interaction.user.id;
  const isBuyer = me === deal.buyerId; const isSeller = me === deal.sellerId;
  const update = async () => interaction.update(view(deal, settings));

  if (action === 'accept' || action === 'decline') {
    if (!isSeller) return deny('Принять или отклонить сделку может только продавец.');
    if (deal.status !== 'pending') return deny('Сделка уже не ждёт ответа.');
    if (action === 'decline') { await settle(deal, 'buyer', 'Продавец отклонил сделку.', settings); return update(); }
    const [changed] = await EconomyDeal.update({ status: 'active' }, { where: { id: deal.id, status: 'pending' } });
    if (!changed) return deny('Сделка уже не ждёт ответа.');
    deal.status = 'active';
    return update();
  }
  if (action === 'cancel') {
    if (!isBuyer) return deny('Отменить сделку до того, как её примут, может только покупатель.');
    if (deal.status !== 'pending') return deny('Сделку уже приняли: теперь её можно завершить или открыть спор.');
    await settle(deal, 'buyer', 'Покупатель отменил сделку.', settings); return update();
  }
  if (action === 'done') {
    if (!isBuyer && !isSeller) return deny('Это сделка других участников.');
    if (deal.status !== 'active') return deny('Сделка не в работе.');
    await EconomyDeal.update(isBuyer ? { buyerDone: true } : { sellerDone: true }, { where: { id: deal.id } });
    await deal.reload();
    if (deal.buyerDone && deal.sellerDone) await settle(deal, 'seller', 'Обе стороны подтвердили выполнение.', settings);
    return update();
  }
  if (action === 'dispute') {
    if (!isBuyer && !isSeller) return deny('Это сделка других участников.');
    if (deal.status !== 'active') return deny('Сделка не в работе.');
    await EconomyDeal.update({ status: 'disputed' }, { where: { id: deal.id, status: 'active' } });
    deal.status = 'disputed';
    await update();
    return interaction.followUp({ content: `Спор по сделке №${deal.id}: нужен модератор. Решение — кнопками под сделкой.`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  if (action === 'toSeller' || action === 'toBuyer') {
    if (!isModerator(interaction.member)) return deny('Спор решает модератор.');
    if (isBuyer || isSeller) return deny('Нельзя решать спор в своей сделке.');
    if (deal.status !== 'disputed') return deny('Спора по этой сделке нет.');
    await settle(deal, action === 'toSeller' ? 'seller' : 'buyer', `Спор решил модератор <@${me}>.`, settings);
    return update();
  }
  return deny('Неизвестное действие.');
}

module.exports = { open, settle, view, expireDue, refreshMessage, isDealComponent, handleDealComponent, isModerator };
