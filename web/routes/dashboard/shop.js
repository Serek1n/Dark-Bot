const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, getUsers, botApi } = require('../../discordApi');
const { ShopItem, Purchase, TempRole } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');

const { roleGuard } = require('../../utils/roles');
const { parseDuration } = require('../../../bot/utils/duration');

const TERM_MAX_S = 366 * 24 * 3600; // like /temprole
/** "10д", "12 ч", "1мес" → seconds; empty → null (forever); undefined when the text is not a term or out of range. */
function termSeconds(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const ms = parseDuration(text);
  if (!ms || ms < 60_000 || ms / 1000 > TERM_MAX_S) return undefined;
  return Math.round(ms / 1000);
}

const router = express.Router();

// ---- Shop: editable items, purchase history ----
const SHOP_MAX_ITEMS = 25;
const TERMS_SHOWN = 100; // active roles on a term listed on the page
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
    durationSeconds: type === 'role' ? termSeconds(body.duration) : null,
    stock: stockRaw === '' ? null : clampInt(stockRaw, 0, 1000000, 0),
    minLevel: clampInt(body.minLevel, 0, 1000, 0),
    deliveryMessage: String(body.deliveryMessage || '').trim().slice(0, 500) || null,
    enabled: body.enabled === 'on' || body.enabled === '1'
  };
};
const validItem = (f) => f.name.length > 0 && (f.type !== 'role' || f.roleId) && f.durationSeconds !== undefined;
// A role sold in the shop must be one this user may hand out (an unchanged role of an existing item is kept).
const roleRefused = async (req, f, current) => f.type === 'role' && f.roleId !== current?.roleId && Boolean((await roleGuard(req.params.guildId, req.user?.id)).check(f.roleId));

router.get('/:guildId/shop', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels, allRoles, guard] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId), getGuildRoles(guildId), roleGuard(guildId, req.user?.id)]);
  const roles = guard.annotate(allRoles);
  const items = await ShopItem.findAll({ where: { guildId }, order: [['id', 'ASC']] });
  const [purchases, terms] = await Promise.all([
    Purchase.findAll({ where: { guildId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 30 }),
    TempRole.findAll({ where: { guildId }, order: [['expiresAt', 'ASC'], ['id', 'ASC']], limit: TERMS_SHOWN, raw: true })
  ]);
  const users = await getUsers([...new Set([...purchases.map((p) => p.userId), ...terms.map((t) => t.userId)])]);
  const pending = await Purchase.count({ where: { guildId, status: 'pending' } });
  res.render('dashboard/shop', { guild, settings, channels, roles, items, purchases, terms, users, pending, maxItems: SHOP_MAX_ITEMS, active: 'shop' });
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
  if (fields.durationSeconds === undefined) return res.redirect(saved(guildId, 'shop', 'badterm'));
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
  if (fields.durationSeconds === undefined) return res.redirect(saved(guildId, 'shop', 'badterm'));
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

// A role on a term (bought in the shop or given by /temprole) can be taken away before its end. The same rule as for giving:
// only someone who may hand out this role through the panel may take it.
router.post('/:guildId/shop/terms/:id/revoke', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const row = await TempRole.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!row) return res.redirect(saved(guildId, 'shop', 'invalid'));
  if ((await roleGuard(guildId, req.user?.id)).check(row.roleId)) return res.redirect(saved(guildId, 'shop', 'rolenotallowed'));
  const reason = { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Роль на время снята досрочно в панели') } };
  try {
    await botApi.delete(`/guilds/${guildId}/members/${row.userId}/roles/${row.roleId}`, reason);
  } catch (err) {
    const status = err?.response?.status;
    if (status !== 404) return res.redirect(saved(guildId, 'shop', 'revokefail')); // 404: the member left or the role is gone
  }
  await row.destroy();
  res.redirect(saved(guildId, 'shop', 'revoked'));
});

module.exports = router;
module.exports.termSeconds = termSeconds;
