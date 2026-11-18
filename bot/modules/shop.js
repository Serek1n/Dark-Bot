const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { Op } = require('sequelize');
const { ShopItem, Purchase, inTransaction } = require('../../db');
const { getOrCreateProfile, getOrCreateSettings } = require('./leveling');
const { spend, credit } = require('./wallet');
const { withLock } = require('../utils/lock');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { formatTerm } = require('../utils/duration');
const tempRoles = require('./tempRoles');
const { canSelfGive } = require('../utils/safeRole');

const PREFIX = 'shop';
const MAX_ITEMS = 25; // one select menu holds 25 options
const CURRENCIES = { coins: { field: 'balance', nameKey: 'currencyName' }, crystals: { field: 'crystals', nameKey: 'crystalName' } };

const currencyField = (cur) => (CURRENCIES[cur] || CURRENCIES.coins).field;
const currencyName = (settings, cur) => settings[(CURRENCIES[cur] || CURRENCIES.coins).nameKey];
const cut = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');

/** Enabled items of a server, cheapest first within a currency (what members see). */
async function listItems(guildId) {
  const items = await ShopItem.findAll({ where: { guildId, enabled: true }, order: [['currency', 'ASC'], ['price', 'ASC'], ['id', 'ASC']], limit: MAX_ITEMS });
  return items;
}

function itemLine(item, settings) {
  const bits = [`**${cut(item.name, 60)}** — ${fmt(item.price)} ${currencyName(settings, item.currency)}`];
  const extra = [];
  if (item.description) extra.push(cut(item.description, 90));
  if (item.type === 'role' && item.durationSeconds) extra.push(`на ${formatTerm(item.durationSeconds * 1000)}`);
  if (item.minLevel > 0) extra.push(`с ${item.minLevel} уровня`);
  if (item.oncePerUser) extra.push('можно купить один раз');
  if (item.stock !== null && item.stock !== undefined) extra.push(item.stock > 0 ? `осталось ${item.stock}` : 'закончился');
  return extra.length ? `${bits[0]}\n> ${extra.join(' · ')}` : bits[0];
}

/** The /shop panel: item list + a select menu to pick what to buy. Works for the person who opened it. */
async function buildShopPanel(guild, userId) {
  const settings = await getOrCreateSettings(guild.id);
  if (!settings.shopEnabled) return { error: 'Магазин на этом сервере выключен.' };
  const items = await listItems(guild.id);
  if (!items.length) return { error: 'В магазине пока ничего нет. Администраторы добавляют товары в веб-панели.' };
  const profile = await getOrCreateProfile(guild.id, userId);

  let description = items.map((i) => itemLine(i, settings)).join('\n\n');
  if (description.length > 3900) description = `${description.slice(0, 3890)}…`;
  const embed = embeds
    .baseEmbed()
    .setTitle('Магазин')
    .setDescription(description)
    .setFooter({ text: `Ваш баланс: ${fmt(profile.balance)} ${settings.currencyName} · ${fmt(profile.crystals)} ${settings.crystalName}` });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:pick:${userId}`)
    .setPlaceholder('Выберите, что купить')
    .addOptions(
      items.map((i) => ({
        label: cut(i.name, 100),
        value: String(i.id),
        description: cut(`${fmt(i.price)} ${currencyName(settings, i.currency)}${i.type === 'role' && i.durationSeconds ? ` · на ${formatTerm(i.durationSeconds * 1000)}` : ''}${i.stock === 0 ? ' · закончился' : ''}`, 100)
      }))
    );
  const mine = new ButtonBuilder().setCustomId(`${PREFIX}:mine:${userId}`).setLabel('Мои покупки').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(mine)] };
}

/**
 * Buys an item. Everything that can fail is checked BEFORE any money moves, and the whole
 * purchase runs under one lock per server so two people can't take the last piece, and one
 * person can't spend the same coins twice.
 * Returns { ok: true, item, purchase, settings, balanceAfter } or { ok: false, error }.
 */
function purchaseItem({ guild, member, itemId, expectedPrice = null }) {
  return withLock(`shop:${guild.id}`, async () => {
    const settings = await getOrCreateSettings(guild.id);
    if (!settings.shopEnabled) return { ok: false, error: 'Магазин выключен.' };
    const item = await ShopItem.findOne({ where: { id: itemId, guildId: guild.id } });
    if (!item || !item.enabled) return { ok: false, error: 'Этот товар больше недоступен.' };
    if (expectedPrice !== null && Number.isFinite(expectedPrice) && Number(item.price) !== expectedPrice) {
      return { ok: false, error: `Цена изменилась: теперь ${fmt(item.price)} ${currencyName(settings, item.currency)}. Откройте товар заново.` };
    }
    if (item.stock !== null && item.stock !== undefined && item.stock <= 0) return { ok: false, error: 'Товар закончился.' };

    const profile = await getOrCreateProfile(guild.id, member.id);
    if (item.minLevel > 0 && profile.level < item.minLevel) return { ok: false, error: `Товар доступен с ${item.minLevel} уровня, у вас ${profile.level}.` };
    // checked under the same lock as the purchase: two quick clicks can't both pass
    if (item.oncePerUser && (await boughtBefore(guild.id, member.id, item.id))) return { ok: false, error: 'Этот товар можно купить только один раз, и вы его уже покупали.' };

    const field = currencyField(item.currency);
    const cName = currencyName(settings, item.currency);
    if (Number(profile[field]) < item.price) return { ok: false, error: `Не хватает: нужно ${fmt(item.price)} ${cName}, у вас ${fmt(profile[field])}.` };

    const timed = item.type === 'role' && item.durationSeconds > 0;
    if (item.type === 'role') {
      const role = guild.roles.cache.get(item.roleId);
      if (!role) return { ok: false, error: 'Роль этого товара удалена с сервера. Сообщите администрации.' };
      // a role on a term can be bought again to prolong it; a role held for good can't be bought
      if (member.roles.cache.has(item.roleId) && !(timed && (await tempRoles.termOf(guild.id, member.id, item.roleId)))) {
        return { ok: false, error: 'У вас уже есть эта роль.' };
      }
      if (guild.members?.me && !guild.members.me.permissions?.has?.('ManageRoles')) return { ok: false, error: 'Бот не может выдать эту роль: у него нет права «Управлять ролями». Сообщите администрации.' };
      if (role.managed) return { ok: false, error: 'Эту роль выдаёт интеграция, а не бот. Сообщите администрации.' };
      if (!role.editable) return { ok: false, error: 'Бот не может выдать эту роль: она выше роли бота. Администрации нужно поднять роль бота выше.' };
      if (!canSelfGive(role, guild)) return { ok: false, error: 'Эта роль даёт права управления сервером, магазин её не выдаёт. Сообщите администрации.' };
    }

    // ONE transaction: the piece of a limited item, the money, the line in the journal, the shop tax and the purchase itself.
    // Either all of it is written or none of it — a stop of the process can no longer leave coins spent with no purchase.
    // A role is given after that, outside the transaction (it is Discord): its purchase is 'delivering' until the role is
    // really there; a purchase left 'delivering' by a crash is finished on the next start (resumeDeliveries).
    const limited = item.stock !== null && item.stock !== undefined;
    const status = item.type === 'role' ? 'delivering' : item.deliveryMessage ? 'done' : 'pending';
    const econ = require('./econ/config');
    const ledger = require('./econ/ledger');
    let purchase; let balanceAfter;
    const outcome = await inTransaction(async (t) => {
      if (limited) {
        const [[, reserved]] = await ShopItem.decrement('stock', { by: 1, where: { id: item.id, enabled: true, stock: { [Op.gt]: 0 } }, transaction: t });
        if (!reserved) return 'stock';
      }
      balanceAfter = await spend(guild.id, member.id, field, item.price, t);
      if (balanceAfter === null) throw new NotEnough(); // rolls the reserved piece back too
      await ledger.record({ guildId: guild.id, userId: member.id, currency: item.currency === 'crystals' ? 'crystals' : 'coins', amount: -item.price, kind: 'shop', note: item.name }, t);
      if (field === 'balance' && econ.isOn(settings, 'treasury')) {
        const tax = Math.floor(item.price * econ.params(settings, 'treasury').shopTax / 100);
        if (tax > 0) await ledger.treasuryAdd(guild.id, tax, t);
      }
      purchase = await Purchase.create({
        guildId: guild.id, userId: member.id, itemId: item.id, itemName: item.name, itemType: item.type,
        roleId: item.type === 'role' ? item.roleId : null, price: item.price, currency: item.currency, status, expiresAt: null
      }, { transaction: t });
      return 'ok';
    }).catch((err) => {
      if (err instanceof NotEnough) return 'money';
      logger.error('Shop: the purchase was not saved:', err);
      return 'error';
    });
    if (outcome === 'stock') return { ok: false, error: 'Товар закончился.' };
    if (outcome === 'money') return { ok: false, error: `Не хватает: нужно ${fmt(item.price)} ${cName}.` };
    if (outcome !== 'ok') return { ok: false, error: 'Не получилось оформить покупку. С вас ничего не списано.' };

    let term = null;
    if (item.type === 'role') {
      const given = await deliverRole(guild, member, item, purchase);
      if (!given.ok) return { ok: false, error: 'Не удалось выдать роль. С вас ничего не списано.' };
      term = given.term;
    }
    return { ok: true, item, purchase, settings, balanceAfter, currencyName: cName, extended: Boolean(term?.extended) };
  });
}

class NotEnough extends Error {}

/**
 * Gives the role of a paid purchase and marks it done. If Discord refuses, the whole purchase is undone in ONE transaction
 * (money back, the piece back, the journal line, status «refunded»). Returns { ok, term }.
 */
async function deliverRole(guild, member, item, purchase) {
  const timed = item.durationSeconds > 0;
  let term = null;
  try {
    if (timed) term = await tempRoles.giveOrExtend(guild, member, item.roleId, item.durationSeconds * 1000, `shop:${item.id}`, `Покупка в магазине: ${item.name}`);
    else await member.roles.add(item.roleId, `Покупка в магазине: ${item.name}`);
  } catch (err) {
    logger.error('Shop: could not give role:', err);
    await refundPurchase(purchase.id, 'роль не выдана').catch((e) => logger.error('Shop: refund failed:', e));
    return { ok: false };
  }
  await purchase.update({ status: 'done', ...(term ? { expiresAt: term.expiresAt } : {}) });
  return { ok: true, term };
}

/**
 * Undoes a purchase once, in one transaction: status «refunded» (only if it was not yet), the money back, the journal line and
 * the piece of a limited item. Returns the purchase, or null when it was already refunded. The role itself is the caller's.
 */
async function refundPurchase(purchaseId, note = null) {
  return inTransaction(async (t) => {
    const p = await Purchase.findByPk(purchaseId, { transaction: t });
    if (!p || p.status === 'refunded') return null;
    const [changed] = await Purchase.update({ status: 'refunded' }, { where: { id: p.id, status: { [Op.ne]: 'refunded' } }, transaction: t });
    if (!changed) return null;
    const field = currencyField(p.currency);
    await credit(p.guildId, p.userId, field, p.price, t);
    await require('./econ/ledger').record({ guildId: p.guildId, userId: p.userId, currency: p.currency === 'crystals' ? 'crystals' : 'coins', amount: p.price, kind: 'refund', note: note ? `${p.itemName}: ${note}` : p.itemName }, t);
    if (p.itemId) await ShopItem.increment('stock', { by: 1, where: { id: p.itemId, guildId: p.guildId, stock: { [Op.ne]: null } }, transaction: t });
    return p;
  });
}

/**
 * On start: purchases of a role that were paid but not finished (the process stopped between the payment and the role).
 * The role is given now; a member who has left, a role that is gone or a Discord that refuses → the purchase is refunded.
 * A Discord that could not be asked (429, 5xx) → it stays for the next start. Never throws.
 */
async function resumeDeliveries(client) {
  const { isGone } = require('../utils/discordErrors');
  const rows = await Purchase.findAll({ where: { status: 'delivering' }, limit: 200 }).catch(() => []);
  for (const p of rows) {
    try {
      const guild = client.guilds.cache.get(p.guildId);
      if (!guild) continue;
      const item = p.itemId ? await ShopItem.findOne({ where: { id: p.itemId, guildId: p.guildId } }) : null;
      let member = null;
      try { member = await guild.members.fetch(p.userId); } catch (err) { if (!isGone(err)) continue; }
      if (!member || !item || !guild.roles.cache.get(p.roleId)) { await refundPurchase(p.id, 'не удалось выдать'); continue; }
      await deliverRole(guild, member, { ...item.get({ plain: true }), roleId: p.roleId }, p);
    } catch (err) {
      logger.warn(`Shop: purchase ${p.id} after restart: ${err.message}`);
    }
  }
}

/** Has this member already bought this item (a refunded purchase does not count)? */
function boughtBefore(guildId, userId, itemId) {
  return Purchase.count({ where: { guildId, userId, itemId, status: { [Op.ne]: 'refunded' } } }).then((n) => n > 0);
}

/** Posts the purchase to the server's shop log channel (if one is set). Never throws. */
async function logPurchase(guild, user, result) {
  try {
    const { settings, item, purchase, currencyName: cName } = result;
    if (!settings.shopLogChannelId) return;
    const channel = guild.channels.cache.get(settings.shopLogChannelId) || (await guild.channels.fetch(settings.shopLogChannelId).catch(() => null));
    if (!channel?.send) return;
    const embed = embeds
      .baseEmbed()
      .setTitle('Покупка в магазине')
      .setDescription(`<@${user.id}> купил(а) **${item.name}** за ${fmt(purchase.price)} ${cName}${purchase.expiresAt ? ` · ${result.extended ? 'продлено' : 'действует'} до <t:${unix(purchase.expiresAt)}:f>` : ''}`);
    if (purchase.status === 'pending') embed.addFields({ name: 'Нужно выдать вручную', value: 'Отметьте выдачу в веб-панели, раздел «Магазин».' });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Shop log failed:', err);
  }
}

function purchaseReceipt(result) {
  const { item, purchase, balanceAfter, currencyName: cName } = result;
  const embed = embeds.baseEmbed(embeds.COLORS.success).setTitle('Покупка совершена').setDescription(`**${item.name}** — ${fmt(purchase.price)} ${cName}`);
  if (item.type === 'role' && purchase.expiresAt) {
    embed.addFields({ name: 'Роль', value: `<@&${item.roleId}> ${result.extended ? 'продлена' : 'выдана'} до <t:${unix(purchase.expiresAt)}:f> (<t:${unix(purchase.expiresAt)}:R>), потом снимется сама` });
  } else if (item.type === 'role') embed.addFields({ name: 'Роль', value: `<@&${item.roleId}> выдана` });
  if (item.deliveryMessage) embed.addFields({ name: 'Ваш товар', value: cut(item.deliveryMessage, 1000) });
  else if (purchase.status === 'pending') embed.addFields({ name: 'Выдача', value: 'Администрация выдаст товар вручную, обычно это быстро.' });
  embed.setFooter({ text: `Остаток: ${fmt(balanceAfter)} ${cName}` });
  return embed;
}

const STATUS_RU = { done: 'выдано', pending: 'ждёт выдачи', delivering: 'выдаётся', refunded: 'возвращено' };

async function myPurchasesEmbed(guild, userId) {
  const settings = await getOrCreateSettings(guild.id);
  const rows = await Purchase.findAll({ where: { guildId: guild.id, userId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 10 });
  if (!rows.length) return embeds.info('Вы пока ничего не покупали.');
  const lines = rows.map((p) => `**${cut(p.itemName, 60)}** — ${fmt(p.price)} ${currencyName(settings, p.currency)} · ${STATUS_RU[p.status] || p.status}${p.expiresAt ? ` до <t:${unix(p.expiresAt)}:d>` : ''} · <t:${Math.floor(new Date(p.createdAt).getTime() / 1000)}:d>`);
  return embeds.baseEmbed().setTitle('Мои покупки').setDescription(lines.join('\n'));
}

// ---------- components ----------

function isShopComponent(interaction) {
  const ok = interaction.isButton?.() || interaction.isStringSelectMenu?.();
  return Boolean(ok) && String(interaction.customId).startsWith(`${PREFIX}:`);
}

const ephemeral = MessageFlags.Ephemeral;

async function handleShopComponent(interaction) {
  const parts = String(interaction.customId).split(':'); // shop:<action>:...:<ownerId>
  const action = parts[1];
  const ownerId = parts[parts.length - 1];
  if (ownerId && interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [embeds.info('Это магазин другого участника. Откройте свой: `/shop`.')], flags: ephemeral });
  }

  if (action === 'pick') {
    const itemId = Number(interaction.values?.[0]);
    const item = await ShopItem.findOne({ where: { id: itemId, guildId: interaction.guild.id } });
    if (!item || !item.enabled) return interaction.reply({ embeds: [embeds.error('Этот товар больше недоступен.')], flags: ephemeral });
    if (item.oncePerUser && (await boughtBefore(interaction.guild.id, interaction.user.id, item.id))) {
      return interaction.reply({ embeds: [embeds.info('Этот товар можно купить только один раз, и вы его уже покупали.')], flags: ephemeral });
    }
    const settings = await getOrCreateSettings(interaction.guild.id);
    const embed = embeds
      .baseEmbed()
      .setTitle('Подтвердите покупку')
      .setDescription(`**${item.name}**${item.description ? `\n${cut(item.description, 300)}` : ''}${item.type === 'role' && item.durationSeconds ? (item.oncePerUser ? `\nСрок: **${formatTerm(item.durationSeconds * 1000)}** — потом роль снимется` : `\nСрок: **${formatTerm(item.durationSeconds * 1000)}** — потом роль снимется (повторная покупка продлевает)`) : ''}${item.oncePerUser ? '\nКупить можно только один раз.' : ''}\n\nЦена: **${fmt(item.price)} ${currencyName(settings, item.currency)}**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:buy:${item.id}:${interaction.user.id}:${item.price}`).setLabel('Купить').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${interaction.user.id}`).setLabel('Отмена').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row], flags: ephemeral });
  }

  if (action === 'cancel') {
    return interaction.update({ embeds: [embeds.info('Покупка отменена.')], components: [] });
  }

  if (action === 'mine') {
    return interaction.reply({ embeds: [await myPurchasesEmbed(interaction.guild, interaction.user.id)], flags: ephemeral });
  }

  if (action === 'buy') {
    const itemId = Number(parts[2]);
    // Disable the button right away: a double click must not buy twice.
    await interaction.update({ embeds: [embeds.info('Оформляю покупку…')], components: [] });
    const member = interaction.member || (await interaction.guild.members.fetch(interaction.user.id));
    // the price shown on the confirmation is the price paid: if the panel changed it meanwhile, nothing is bought
    const shownPrice = parts[4] !== undefined ? Number(parts[4]) : null;
    const result = await purchaseItem({ guild: interaction.guild, member, itemId, expectedPrice: shownPrice });
    if (!result.ok) return interaction.editReply({ embeds: [embeds.error(result.error)], components: [] });
    await interaction.editReply({ embeds: [purchaseReceipt(result)], components: [] });
    await logPurchase(interaction.guild, interaction.user, result);
  }
}

module.exports = { refundPurchase, resumeDeliveries, deliverRole, boughtBefore, buildShopPanel, purchaseItem, logPurchase, purchaseReceipt, isShopComponent, handleShopComponent, listItems, MAX_ITEMS, STATUS_RU, CURRENCIES };
