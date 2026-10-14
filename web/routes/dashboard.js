const express = require('express');
const { Op } = require('sequelize');
const { ensureAuth } = require('../middleware/ensureAuth');
const { ensureGuildAccess } = require('../middleware/ensureGuildAccess');
const { getBotGuilds, getBotGuildIds, getGuildChannels, getGuildRoles, getGuild, getUsers, botApi } = require('../discordApi');
const {
  GuildSettings,
  MemberProfile,
  Warning,
  ModLog,
  CustomCommand,
  LevelRole,
  ReactionRole,
  Alert,
  ShopItem,
  Purchase
} = require('../../db');

const { CATEGORIES, KEYS: LOG_KEYS } = require('../../bot/utils/logCategories');
const { setupLogForum } = require('../utils/logForum');
const { refreshUserGuilds } = require('../utils/userGuilds');

const router = express.Router();

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseWords(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Discord IDs from forms: accept only real snowflakes (or empty = "not set").
const snowflake = (v) => (/^\d{15,25}$/.test(String(v || '').trim()) ? String(v).trim() : null);

const saved = (guildId, page, flag = 'saved') => `/dashboard/${guildId}/${page}?${flag}=1`;
router.use(ensureAuth);

const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;
function hasManageAccess(guild) {
  if (guild.owner) return true;
  const perms = BigInt(guild.permissions || 0);
  return (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD) || (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR);
}

// ---- Guild picker ----
router.get('/', async (req, res) => {
  const [botGuilds, userGuilds] = await Promise.all([getBotGuilds(), refreshUserGuilds(req, { force: true })]);
  const guilds = userGuilds.filter(hasManageAccess).map((g) => {
    const live = botGuilds.get(g.id); // the bot's own data has the current name and icon
    return { ...g, name: live?.name || g.name, icon: live ? live.icon : g.icon, botPresent: Boolean(live) };
  });
  // Servers with the bot first, then the rest, each alphabetically.
  guilds.sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
  res.render('guilds', { guilds });
});

async function getSettings(guildId) {
  const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
  return settings;
}

// ---- Overview ----
router.get('/:guildId', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const memberCount = await MemberProfile.count({ where: { guildId: req.params.guildId } });
  const warningCount = await Warning.count({ where: { guildId: req.params.guildId } });
  const reactionRoleCount = await ReactionRole.count({ where: { guildId: req.params.guildId } });
  const customCommandCount = await CustomCommand.count({ where: { guildId: req.params.guildId } });
  const alertCount = await Alert.count({ where: { guildId: req.params.guildId } });
  const topMembers = await MemberProfile.findAll({ where: { guildId: req.params.guildId }, order: [['xp', 'DESC']], limit: 5 });
  const recentLogs = await ModLog.findAll({ where: { guildId: req.params.guildId }, order: [['createdAt', 'DESC']], limit: 5 });
  const users = await getUsers([...topMembers.map((p) => p.userId), ...recentLogs.flatMap((l) => [l.userId, l.moderatorId])]);
  res.render('dashboard/overview', {
    guild,
    settings,
    topMembers,
    recentLogs,
    users,
    memberCount,
    warningCount,
    reactionRoleCount,
    customCommandCount,
    alertCount,
    active: 'overview'
  });
});

// ---- Leveling settings ----
router.get('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  // Result of the last manual level change (the redirect carries it in the query string).
  let adjusted = null;
  const q = req.query;
  if (q.adjusted && snowflake(q.u)) {
    const users = await getUsers([q.u]);
    adjusted = { name: users[q.u]?.name || q.u, from: clampInt(q.from, 0, 1000, 0), to: clampInt(q.to, 0, 1000, 0), roles: ['ok', 'fail', 'none'].includes(q.roles) ? q.roles : 'none' };
  }
  res.render('dashboard/leveling', { guild, settings, channels, adjusted, prefillUser: snowflake(q.user) || '', active: 'leveling' });
});

// Manual level change: add, take away or set an exact level. Roles for levels are updated right away.
router.post('/:guildId/leveling/adjust', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'leveling', 'baduser'));
  const mode = ['add', 'remove', 'set'].includes(req.body.mode) ? req.body.mode : 'add';
  const { computeLevelAdjust, MAX_LEVEL } = require('../../bot/modules/leveling');
  const amount = clampInt(req.body.amount, mode === 'set' ? 0 : 1, MAX_LEVEL, mode === 'set' ? 0 : 1);

  const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
  const result = computeLevelAdjust(profile, mode, amount);
  await profile.update({ xp: result.xp, level: result.level, chatXp: result.chatXp, voiceXp: result.voiceXp });

  // Level roles (best effort: the member may have left, or the bot may not be allowed to give a role).
  let roles = 'none';
  try {
    const settings = await getSettings(guildId);
    const levelRoles = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId, track: r.track }));
    if (levelRoles.length) {
      const { computeAdjustRoleChanges } = require('../../bot/modules/levelRoles');
      const member = await botApi.get(`/guilds/${guildId}/members/${userId}`).then((r) => r.data).catch(() => null);
      if (member && !member.user?.bot) {
        const { add, remove } = computeAdjustRoleChanges(levelRoles, result.level, member.roles || [], settings.levelRolesReplace, result.level < result.previousLevel);
        const reason = { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Уровень изменён администратором') } };
        let failed = false;
        for (const id of add) await botApi.put(`/guilds/${guildId}/members/${userId}/roles/${id}`, null, reason).catch(() => { failed = true; });
        for (const id of remove) await botApi.delete(`/guilds/${guildId}/members/${userId}/roles/${id}`, reason).catch(() => { failed = true; });
        roles = failed ? 'fail' : 'ok';
      }
    }
  } catch (err) {
    roles = 'fail';
  }
  res.redirect(`/dashboard/${guildId}/leveling?adjusted=1&u=${userId}&from=${result.previousLevel}&to=${result.level}&roles=${roles}#adjust`);
});

router.post('/:guildId/leveling', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelingEnabled = req.body.levelingEnabled === 'on';
  // Chat direction
  settings.chatEnabled = req.body.chatEnabled === 'on';
  const min = clampInt(req.body.xpPerMessageMin, 1, 1000, settings.xpPerMessageMin);
  const max = clampInt(req.body.xpPerMessageMax, 1, 1000, settings.xpPerMessageMax);
  settings.xpPerMessageMin = Math.min(min, max);
  settings.xpPerMessageMax = Math.max(min, max);
  settings.xpCooldownSeconds = clampInt(req.body.xpCooldownSeconds, 0, 3600, settings.xpCooldownSeconds);
  settings.chatCoinsPerMessage = clampInt(req.body.chatCoinsPerMessage, 0, 10000, settings.chatCoinsPerMessage);
  // Voice direction
  settings.voiceEnabled = req.body.voiceEnabled === 'on';
  settings.voiceXpPerMinute = clampInt(req.body.voiceXpPerMinute, 0, 500, settings.voiceXpPerMinute);
  settings.voiceCoinsPerMinute = clampInt(req.body.voiceCoinsPerMinute, 0, 10000, settings.voiceCoinsPerMinute);
  settings.voiceMinMembers = clampInt(req.body.voiceMinMembers, 1, 10, settings.voiceMinMembers);
  settings.crystalsPerLevel = clampInt(req.body.crystalsPerLevel, 0, 10000, settings.crystalsPerLevel);
  settings.levelUpChannelId = snowflake(req.body.levelUpChannelId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'leveling'));
});

// ---- Features: switch parts of the bot on and off ----
const { FEATURES } = require('../../bot/utils/features');

router.get('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  res.render('dashboard/features', { guild, settings, features: FEATURES, active: 'features' });
});

router.post('/:guildId/features', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  FEATURES.forEach((f) => { settings[f.field] = req.body[f.field] === 'on'; });
  await settings.save();
  res.redirect(saved(req.params.guildId, 'features'));
});

// ---- Economy: currencies ----
router.get('/:guildId/economy', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const where = { guildId: req.params.guildId };
  const [coinsTotal, crystalsTotal, holders] = await Promise.all([
    MemberProfile.sum('balance', { where }),
    MemberProfile.sum('crystals', { where }),
    MemberProfile.count({ where: { guildId: req.params.guildId, balance: { [Op.gt]: 0 } } })
  ]);
  const richest = await MemberProfile.findAll({ where, order: [['balance', 'DESC']], limit: 5 });
  const users = await getUsers(richest.map((p) => p.userId));
  res.render('dashboard/economy', { guild, settings, stats: { coinsTotal: coinsTotal || 0, crystalsTotal: crystalsTotal || 0, holders }, richest, users, active: 'economy' });
});

// Manual correction of a member's wallet (add or take away); never goes below zero.
router.post('/:guildId/economy/grant', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'economy', 'baduser'));
  const field = req.body.currency === 'crystals' ? 'crystals' : 'balance';
  const amount = clampInt(req.body.amount, -1000000000, 1000000000, 0);
  const [profile] = await MemberProfile.findOrCreate({ where: { guildId, userId } });
  profile[field] = Math.max(0, Number(profile[field] || 0) + amount);
  await profile.save();
  res.redirect(saved(guildId, 'economy', 'granted'));
});

router.post('/:guildId/economy', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const name = (v, fallback) => String(v || '').trim().slice(0, 24) || fallback;
  settings.currencyName = name(req.body.currencyName, settings.currencyName);
  settings.crystalName = name(req.body.crystalName, settings.crystalName);
  settings.dailyCoins = clampInt(req.body.dailyCoins, 0, 1000000, settings.dailyCoins);
  settings.dailyStreakBonus = clampInt(req.body.dailyStreakBonus, 0, 1000000, settings.dailyStreakBonus);
  settings.dailyStreakMax = clampInt(req.body.dailyStreakMax, 1, 365, settings.dailyStreakMax);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'economy'));
});

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

router.get('/:guildId/shop', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = await getGuild(guildId);
  const settings = await getSettings(guildId);
  const channels = await getGuildChannels(guildId);
  const roles = await getGuildRoles(guildId);
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
  await ShopItem.create({ guildId, ...fields });
  res.redirect(saved(guildId, 'shop'));
});

router.post('/:guildId/shop/items/:id', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const item = await ShopItem.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  if (!item) return res.redirect(saved(guildId, 'shop', 'invalid'));
  const fields = STOCK_FIELDS(req.body, item);
  if (!validItem(fields)) return res.redirect(saved(guildId, 'shop', 'invalid'));
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

// ---- Leaderboard (read-only) ----
// Import levels from another bot's export (JSON is read in the browser and sent here).
router.post('/:guildId/leveling/import', ensureGuildAccess, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { importLacuna } = require('../../bot/modules/importLevels');
    const result = await importLacuna(req.params.guildId, req.body && req.body.users);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Ошибка импорта' });
  }
});
// Body-parser problems (too large, bad JSON) answer in JSON too, so the page can show them.
router.use('/:guildId/leveling/import', (err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || 400).json({ ok: false, error: err.type === 'entity.too.large' ? 'Файл слишком большой' : 'Не удалось прочитать файл' });
});

// Export all members' levels (JSON in the same shape the import reads, or CSV for spreadsheets).
router.get('/:guildId/leveling/export', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { totalXpForLevel } = require('../../bot/modules/leveling');
  const profiles = await MemberProfile.findAll({ where: { guildId }, order: [['xp', 'DESC']] });
  const rows = profiles.map((p) => ({
    userId: p.userId,
    level: p.level,
    xp: Number(p.xp),
    progress: Math.max(0, Number(p.xp) - totalXpForLevel(p.level)),
    messages: Number(p.messageCount),
    voiceSeconds: Number(p.voiceSeconds || 0),
    balance: Number(p.balance),
    chatXp: Number(p.chatXp || 0),
    voiceXp: Number(p.voiceXp || 0),
    crystals: Number(p.crystals || 0)
  }));

  if (req.query.format === 'csv') {
    const lines = ['user_id,level,xp,chat_xp,voice_xp,messages,voice_seconds,coins,crystals', ...rows.map((r) => [r.userId, r.level, r.xp, r.chatXp, r.voiceXp, r.messages, r.voiceSeconds, r.balance, r.crystals].join(','))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="levels-${guildId}.csv"` });
    return res.send('\ufeff' + lines.join('\n'));
  }

  const data = rows.map((r) => ({
    _id: r.userId,
    activities: {
      levels: [
        {
          guild_id: guildId,
          experience: { total: r.xp, current: r.progress, level: r.level },
          activity: { total_messages: r.messages, total_voice_time: r.voiceSeconds }
        }
      ],
      wallets: [{ guild_id: guildId, currencies: [{ id: 'DEFAULT', amount: r.balance }] }]
    },
    // Extra data of this bot: both level directions and the second currency.
    dark: { chatXp: r.chatXp, voiceXp: r.voiceXp, crystals: r.crystals }
  }));
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="levels-${guildId}.json"` });
  res.send(JSON.stringify(data, null, 2));
});

router.get('/:guildId/leaderboard', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const tracks = { total: ['xp', 'level'], voice: ['voiceSeconds', 'level'] };
  const track = tracks[req.query.track] ? req.query.track : 'total';
  const [xpField, levelField] = tracks[track];
  const where = track === 'total' ? { guildId: req.params.guildId } : { guildId: req.params.guildId, [xpField]: { [Op.gt]: 0 } };
  const top = await MemberProfile.findAll({ where, order: [[xpField, 'DESC']], limit: 50 });
  const users = await getUsers(top.map((p) => p.userId));
  res.render('dashboard/leaderboard', { guild, top, users, track, xpField, levelField, active: 'leaderboard' });
});

// ---- Moderation: log channel, report channel, mod log + warnings viewer ----
router.get('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const actions = ['warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'clear', 'automod'];
  const action = actions.includes(req.query.action) ? req.query.action : '';
  const where = action ? { guildId: req.params.guildId, action } : { guildId: req.params.guildId };
  const logs = await ModLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 50 });
  const users = await getUsers(logs.flatMap((l) => [l.userId, l.moderatorId]));
  res.render('dashboard/moderation', { guild, settings, channels, logs, users, action, active: 'moderation' });
});

router.post('/:guildId/moderation', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.modLogChannelId = snowflake(req.body.modLogChannelId);
  settings.reportChannelId = snowflake(req.body.reportChannelId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'moderation'));
});

// ---- Logs: the "Логи" forum (one post per kind of event, filled through a webhook) ----
function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

router.get('/:guildId/logs', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  res.render('dashboard/logs', {
    guild,
    settings,
    forums: channels.filter((c) => c.type === 15),
    categories: CATEGORIES,
    threads: parseJson(settings.logThreads, {}),
    disabled: new Set(parseJson(settings.logDisabled, [])),
    active: 'logs'
  });
});

router.post('/:guildId/logs', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const settings = await getSettings(guildId);
  const back = (flag) => res.redirect(`/dashboard/${guildId}/logs?${flag}=1`);

  // Disconnect: the posts stay in Discord, the bot just stops writing.
  if (req.body.action === 'off') {
    if (settings.logWebhookId) await botApi.delete(`/webhooks/${settings.logWebhookId}`, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Логи отключены') } }).catch(() => {});
    settings.logForumChannelId = null;
    settings.logWebhookId = null;
    settings.logWebhookToken = null;
    settings.logThreads = '{}';
    await settings.save();
    return back('logoff');
  }

  const enabled = new Set(LOG_KEYS.filter((k) => req.body['cat_' + k] === 'on'));
  settings.logDisabled = JSON.stringify(LOG_KEYS.filter((k) => !enabled.has(k)));

  const forumId = snowflake(req.body.logForumChannelId);
  if (!forumId) {
    await settings.save();
    return back('saved');
  }
  const sameForum = forumId === settings.logForumChannelId;
  if (sameForum && req.body.action !== 'setup' && settings.logWebhookId) {
    await settings.save();
    return back('saved');
  }

  try {
    const result = await setupLogForum(botApi, forumId, {
      webhookId: sameForum ? settings.logWebhookId : null,
      webhookToken: sameForum ? settings.logWebhookToken : null,
      threads: sameForum ? parseJson(settings.logThreads, {}) : {}
    });
    // Leaving an old forum: its webhook is no longer needed.
    if (!sameForum && settings.logWebhookId) await botApi.delete(`/webhooks/${settings.logWebhookId}`).catch(() => {});
    settings.logForumChannelId = forumId;
    settings.logWebhookId = result.webhookId;
    settings.logWebhookToken = result.webhookToken;
    settings.logThreads = JSON.stringify(result.threads);
    await settings.save();
    return back(result.created.length ? 'logready' : 'saved');
  } catch (err) {
    await settings.save();
    return back(err.code === 'notforum' ? 'lognoforum' : err.code === 'perm' ? 'logperm' : 'logfail');
  }
});

// ---- Automod ----
router.get('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const bannedWords = parseWords(settings.automodBannedWords);
  res.render('dashboard/automod', { guild, settings, bannedWords, active: 'automod' });
});

router.post('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.automodEnabled = req.body.automodEnabled === 'on';
  settings.automodBlockInvites = req.body.automodBlockInvites === 'on';
  settings.automodAntiSpam = req.body.automodAntiSpam === 'on';
  settings.automodSpamMessages = clampInt(req.body.automodSpamMessages, 2, 30, settings.automodSpamMessages);
  settings.automodSpamSeconds = clampInt(req.body.automodSpamSeconds, 2, 60, settings.automodSpamSeconds);
  const words = [
    ...new Set(
      (req.body.bannedWords || '')
        .split(/\r?\n/)
        .map((w) => w.trim().toLowerCase().slice(0, 64))
        .filter(Boolean)
    )
  ].slice(0, 500);
  settings.automodBannedWords = JSON.stringify(words);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'automod'));
});

// ---- Welcome & autorole ----
router.get('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const roles = await getGuildRoles(req.params.guildId);
  res.render('dashboard/welcome', { guild, settings, channels, roles, active: 'welcome' });
});

router.post('/:guildId/welcome', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.welcomeChannelId = snowflake(req.body.welcomeChannelId);
  settings.welcomeMessage = (req.body.welcomeMessage || '').trim().slice(0, 1800) || settings.welcomeMessage;
  settings.autoRoleId = snowflake(req.body.autoRoleId);
  await settings.save();
  res.redirect(saved(req.params.guildId, 'welcome'));
});

// ---- Level roles ----
const syncStatus = new Map(); // guildId -> { running, done, total, error }

router.get('/:guildId/level-roles', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const roles = await getGuildRoles(req.params.guildId);
  const levelRoles = await LevelRole.findAll({ where: { guildId: req.params.guildId, track: 'total' }, order: [['level', 'ASC']] });
  res.render('dashboard/level-roles', { guild, settings, roles, levelRoles, sync: syncStatus.get(req.params.guildId) || null, active: 'level-roles' });
});

router.post('/:guildId/level-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const level = clampInt(req.body.level, 1, 500, 0);
  const roleId = snowflake(req.body.roleId);
  const roles = await getGuildRoles(guildId);
  if (!level || !roleId || !roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'level-roles', 'invalid'));
  const track = 'total';
  // One role per (direction, level): saving the same pair again replaces the role.
  const existing = await LevelRole.findOne({ where: { guildId, level, track } });
  if (existing) await existing.update({ roleId });
  else await LevelRole.create({ guildId, level, roleId, track });
  res.redirect(saved(guildId, 'level-roles'));
});

router.post('/:guildId/level-roles/mode', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.levelRolesReplace = req.body.levelRolesReplace === 'on';
  await settings.save();
  res.redirect(saved(req.params.guildId, 'level-roles'));
});

router.post('/:guildId/level-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await LevelRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'level-roles', 'deleted'));
});

// Gives roles to everyone who already has the level (e.g. after importing levels). Runs in the background.
router.post('/:guildId/level-roles/sync', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  if (syncStatus.get(guildId)?.running) return res.redirect(saved(guildId, 'level-roles', 'running'));
  const settings = await getSettings(guildId);
  const status = { running: true, done: 0, total: 0, error: null };
  syncStatus.set(guildId, status);
  res.redirect(saved(guildId, 'level-roles', 'started'));

  (async () => {
    const { computeTrackRoleChanges } = require('../../bot/modules/levelRoles');
    const levelRoles = (await LevelRole.findAll({ where: { guildId } })).map((r) => ({ level: r.level, roleId: r.roleId, track: r.track }));
    if (!levelRoles.length) return;
    const profiles = await MemberProfile.findAll({ where: { guildId } });
    const levels = new Map(profiles.map((p) => [p.userId, { total: p.level }]));

    // All server members with their roles (paged by 1000).
    const members = [];
    let after = '0';
    for (;;) {
      const { data } = await botApi.get(`/guilds/${guildId}/members`, { params: { limit: 1000, after } });
      members.push(...data);
      if (data.length < 1000) break;
      after = data[data.length - 1].user.id;
    }
    const targets = members.filter((m) => levels.has(m.user.id) && !m.user.bot);
    status.total = targets.length;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const m of targets) {
      const { add, remove } = computeTrackRoleChanges(levelRoles, levels.get(m.user.id), m.roles, settings.levelRolesReplace);
      try {
        for (const id of add) { await botApi.put(`/guilds/${guildId}/members/${m.user.id}/roles/${id}`, null, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Роль за уровень') } }); await pause(300); }
        for (const id of remove) { await botApi.delete(`/guilds/${guildId}/members/${m.user.id}/roles/${id}`); await pause(300); }
      } catch (err) {
        status.failed = (status.failed || 0) + 1; // e.g. role is above the bot's role
      }
      status.done++;
    }
  })()
    .catch((err) => { status.error = err.message; })
    .finally(() => { status.running = false; });
});

// ---- Reaction roles ----
router.get('/:guildId/reaction-roles', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const roles = await getGuildRoles(req.params.guildId);
  const reactionRoles = await ReactionRole.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/reaction-roles', { guild, channels, roles, reactionRoles, flag: req.query, active: 'reaction-roles' });
});

router.post('/:guildId/reaction-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const channelId = snowflake(req.body.channelId);
  const messageId = snowflake(req.body.messageId);
  const roleId = snowflake(req.body.roleId);
  const raw = (req.body.emoji || '').trim();
  const custom = raw.match(/^<a?:(\w+):(\d+)>$/);
  const emoji = custom ? custom[2] : raw;
  if (!channelId || !messageId || !roleId || !emoji || emoji.length > 64) {
    return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  }
  // The message must exist in that channel of this server, otherwise the link would never fire.
  const channels = await getGuildChannels(guildId);
  if (!channels.some((c) => c.id === channelId)) return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  const roles = await getGuildRoles(guildId);
  if (!roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'reaction-roles', 'invalid'));
  const found = await botApi.get(`/channels/${channelId}/messages/${messageId}`).then(() => true).catch(() => false);
  if (!found) return res.redirect(saved(guildId, 'reaction-roles', 'nomessage'));

  await ReactionRole.upsert({ guildId, channelId, messageId, emoji, roleId });
  // Put the reaction under the message so people can click it (best effort).
  const reactionPath = custom ? `${custom[1]}:${custom[2]}` : encodeURIComponent(emoji);
  await botApi.put(`/channels/${channelId}/messages/${messageId}/reactions/${reactionPath}/@me`).catch(() => {});
  res.redirect(saved(guildId, 'reaction-roles'));
});

router.post('/:guildId/reaction-roles/delete/:id', ensureGuildAccess, async (req, res) => {
  await ReactionRole.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'reaction-roles', 'deleted'));
});

// ---- Custom commands ----
router.get('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const commands = await CustomCommand.findAll({ where: { guildId: req.params.guildId } });
  const settings = await getSettings(req.params.guildId);
  res.render('dashboard/custom-commands', { guild, commands, settings, active: 'custom-commands' });
});

router.post('/:guildId/custom-commands/prefix', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const prefix = (req.body.prefix || '').trim().slice(0, 3);
  if (!prefix || /\s/.test(prefix)) return res.redirect(saved(req.params.guildId, 'custom-commands', 'invalid'));
  settings.prefix = prefix;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'custom-commands'));
});

router.post('/:guildId/custom-commands', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  // Triggers are a single word; strip the prefix if the admin typed it ("!rules" -> "rules").
  let trigger = (req.body.trigger || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (settings.prefix && trigger.startsWith(settings.prefix.toLowerCase())) trigger = trigger.slice(settings.prefix.length);
  trigger = trigger.slice(0, 32);
  const response = (req.body.response || '').trim().slice(0, 2000);
  if (!trigger || !response) return res.redirect(saved(req.params.guildId, 'custom-commands', 'invalid'));
  await CustomCommand.upsert({ guildId: req.params.guildId, trigger, response, createdBy: req.user.id });
  res.redirect(saved(req.params.guildId, 'custom-commands'));
});

router.post('/:guildId/custom-commands/delete/:id', ensureGuildAccess, async (req, res) => {
  await CustomCommand.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'custom-commands', 'deleted'));
});

// ---- Temp voice ----
router.get('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const settings = await getSettings(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  res.render('dashboard/temp-voice', { guild, settings, channels, active: 'temp-voice' });
});

router.post('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.tempVoiceJoinChannelId = snowflake(req.body.tempVoiceJoinChannelId);
  settings.tempVoiceCategoryId = snowflake(req.body.tempVoiceCategoryId);
  settings.tempVoiceNameTemplate = (req.body.tempVoiceNameTemplate || '').trim().slice(0, 90) || settings.tempVoiceNameTemplate;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'temp-voice'));
});

// ---- Alerts (YouTube / Twitch) ----
router.get('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const guild = await getGuild(req.params.guildId);
  const channels = await getGuildChannels(req.params.guildId);
  const alerts = await Alert.findAll({ where: { guildId: req.params.guildId } });
  res.render('dashboard/alerts', { guild, channels, alerts, active: 'alerts' });
});

router.post('/:guildId/alerts', ensureGuildAccess, async (req, res) => {
  const { platform, targetId, channelId, message } = req.body;
  // YouTube channel IDs are case-sensitive; Twitch logins are not.
  const rawTarget = (targetId || '').trim().slice(0, 100);
  const target = platform === 'twitch' ? rawTarget.toLowerCase() : rawTarget;
  if (platform === 'youtube' && !/^UC[\w-]{20,}$/.test(target)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
  }
  if (!['youtube', 'twitch'].includes(platform) || !target || !snowflake(channelId)) {
    return res.redirect(saved(req.params.guildId, 'alerts', 'invalid'));
  }
  await Alert.upsert({
    guildId: req.params.guildId,
    platform,
    targetId: target,
    channelId: snowflake(channelId),
    message: (message || '').trim().slice(0, 1000) || undefined
  });
  res.redirect(saved(req.params.guildId, 'alerts'));
});

router.post('/:guildId/alerts/delete/:id', ensureGuildAccess, async (req, res) => {
  await Alert.destroy({ where: { id: req.params.id, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'alerts', 'deleted'));
});

module.exports = router;
