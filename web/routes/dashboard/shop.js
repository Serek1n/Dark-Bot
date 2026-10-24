const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, getUsers } = require('../../discordApi');
const { ShopItem, Purchase } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');

const router = express.Router();

// ---- Shop: editable items, purchase history ----
const SHOP_MAX_ITEMS = 25;
const STOCK_FIELDS = (body, current = {}) => {
  const type = body.type === 'role' ? 'role' : 'item';
  const roleId = type === 'role' ? snowflake(body.roleId) : null;
  const stockRaw = String(body.stock ?? '').trim();
  return {
    name: String(body.name || '').trim().slice(0, 60),
    description: String(body.description || '').trim().slice(0, 200),
    price: clampInt(body.price, 1, 1000000000, current.price || 100),
    currency: body.currency === 'crystals' ? 'crystals' : 'coins',
    type,
    roleId,
    stock: stockRaw === '' ? null : clampInt(stockRaw, 0, 1000000, 0),
    minLevel: clampInt(body.minLevel, 0, 1000, 0),
    deliveryMessage: String(body.deliveryMessage || '').trim().slice(0, 500) || null,
    enabled: body.enabled === 'on' || body.enabled === '1'
  };
};
const validItem = (f) => f.name.length > 0 && (f.type !== 'role' || f.roleId);
// A role sold in the shop must be one this user may hand out (an unchanged role of an existing item is kept).
const roleRefused = async (req, f, current) => f.type === 'role' && f.roleId !== current?.roleId && Boolean((await roleGuard(req.params.guildId, req.user?.id)).check(f.roleId));

router.get('/:guildId/shop', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels, allRoles, guard] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId), getGuildRoles(guildId), roleGuard(guildId, req.user?.id)]);
  const roles = guard.annotate(allRoles);
  const items = await ShopItem.findAll({ where: { guildId }, order: [['id', 'ASC']] });
  const purchases = await Purchase.findAll({ where: { guildId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 30 });
  const users = await getUsers([...new Set(purchases.map((p) => p.userId))]);
  const pending = await Purchase.count({ where: { guildId, status: 'pending' } });
  res.render('dashboard/shop', { guild, settings, channels, roles, items, purchases, users, pending, maxItems: SHOP_MAX_ITEMS, active: 'shop' });
});

router.post('/:guildId/shop/settings', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.shopEnabled = req.body.shopEnabled === 'on';
  settings.shopLogChannelId = snowflake(req.body.shopLogChannelId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'shop'));
});

router.post('/:guildId/shop/items', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const fields = STOCK_FIELDS(req.body);
  if (!validItem(fields)) return res.redirect(saved(guildId, 'shop', 'invalid'));
  if ((await ShopItem.count({ where: { guildId } })) >= SHOP_MAX_ITEMS) return res.redirect(saved(guildId, 'shop', 'invalid'));
  if (await roleRefused(req, fields)) return res.redirect(saved(guildId, 'shop', 'rolenotallowed'));
  await ShopItem.create({ guildId, ...fields });
  res.redirect(saved(guildId, 'shop'));
});

router.post('/:guildId/shop/items/:id', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const item = await ShopItem.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!item) return res.redirect(saved(guildId, 'shop', 'invalid'));
  const fields = STOCK_FIELDS(req.body, item);
  if (!validItem(fields)) return res.redirect(saved(guildId, 'shop', 'invalid'));
  if (await roleRefused(req, fields, item)) return res.redirect(saved(guildId, 'shop', 'rolenotallowed'));
  await item.update(fields);
  res.redirect(saved(guildId, 'shop'));
});

router.post('/:guildId/shop/items/:id/delete', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  await ShopItem.destroy({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  res.redirect(saved(guildId, 'shop', 'deleted'));
});

router.post('/:guildId/shop/purchases/:id/deliver', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const purchase = await Purchase.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (purchase && purchase.status === 'pending') await purchase.update({ status: 'done' });
  res.redirect(saved(guildId, 'shop'));
});

module.exports = router;
