const express = require('express');
const { Op } = require('sequelize');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getUsers, getGuildChannels, getGuildRoles } = require('../../discordApi');
const { MemberProfile, EconomyTx, EconomyHold, EconomyGoal, EconomyDeal, EconomyBadge, sequelize } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');
const config = require('../../../bot/modules/econ/config');
const ledger = require('../../../bot/modules/econ/ledger');

const router = express.Router();
const econ = (name) => require(`../../../bot/modules/econ/${name}`);
const bridge = () => require('../../botBridge');
const textChannels = async (guildId) => (await getGuildChannels(guildId)).filter((c) => c.type === 0 || c.type === 5);

// Which economy page needs which section (web/modules.js): a page of a section that is off sends you to the settings.
const { PAGE_NEEDS } = require('../../modules');
const guard = (page) => async (req, res, next) => {
  const settings = await getSettings(req.params.guildId);
  if (PAGE_NEEDS[page] && !PAGE_NEEDS[page].some((k) => config.isOn(settings, k))) return res.redirect(`/dashboard/${req.params.guildId}/economy`);
  req.econSettings = settings;
  next();
};

// ---- Economy: currencies and how the economy is set up ----
router.get('/:guildId/economy', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), textChannels(req.params.guildId)]);
  const where = { guildId: req.params.guildId };
  const [coinsTotal, crystalsTotal, holders] = await Promise.all([
    MemberProfile.sum('balance', { where }),
    MemberProfile.sum('crystals', { where }),
    MemberProfile.count({ where: { guildId: req.params.guildId, balance: { [Op.gt]: 0 } } })
  ]);
  const richest = await MemberProfile.findAll({ where, order: [['balance', 'DESC']], limit: 5 });
  const users = await getUsers(richest.map((p) => p.userId));
  const params = Object.fromEntries(config.KEYS.map((k) => [k, config.params(settings, k)]));
  res.render('dashboard/economy', {
    guild, settings, channels, stats: { coinsTotal: coinsTotal || 0, crystalsTotal: crystalsTotal || 0, holders }, richest, users, active: 'economy',
    econ: { FEATURES: config.FEATURES, PRESETS: config.PRESETS, mode: config.MODES.includes(settings.economyMode) ? settings.economyMode : 'simple', preset: config.PRESET_BY_KEY[settings.economyPreset] ? settings.economyPreset : 'calm', flags: config.parse(settings.economyFeatures), on: config.enabledKeys(settings), params }
  });
});

// Manual correction of a member's wallet (add or take away); never goes below zero.
router.post('/:guildId/economy/grant', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'economy', 'baduser'));
  const field = req.body.currency === 'crystals' ? 'crystals' : 'balance';
  const amount = clampInt(req.body.amount, -1000000000, 1000000000, 0);
  const problem = await require('../../utils/members').memberProblem(guildId, userId);
  if (problem) return res.redirect(saved(guildId, 'economy', problem));
  await MemberProfile.findOrCreate({ where: { guildId, userId } });
  const before = await MemberProfile.findOne({ where: { guildId, userId }, attributes: [field] });
  // One SQL statement: the bot may pay out coins in the same second, and a read-then-write here would lose one of the two changes.
  await MemberProfile.update({ [field]: sequelize.literal(`MAX(0, COALESCE(${field}, 0) + ${amount})`) }, { where: { guildId, userId } });
  // the journal gets the real change: taking more than there is stops at zero
  const change = amount < 0 ? -Math.min(-amount, Number(before?.[field]) || 0) : amount;
  await ledger.record({ guildId, userId, currency: field === 'crystals' ? 'crystals' : 'coins', amount: change, kind: 'admin', otherId: req.user?.id || null, note: 'Панель' }).catch(() => {});
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
  let change = { added: [], removed: [] };
  if (req.body.mode !== undefined) {
    if (req.body.eventsChannelId && !(await textChannels(req.params.guildId)).some((c) => c.id === req.body.eventsChannelId)) req.body.eventsChannelId = '';
    change = config.applyForm(settings, req.body);
  }
  await settings.save();
  await econ('seasons').ensureStarted(settings);
  bridge().settingsChanged?.(req.params.guildId);
  // the bot tells the server what was just switched on (the way the admin chose: each, one summary, or quiet)
  if (change.added.length) await econ('events').announceActivation(settings, change.added).catch(() => {});
  res.redirect(saved(req.params.guildId, 'economy'));
});

// ---- Central bank and seasons ----
router.get('/:guildId/economy-bank', ensureGuildAccess, guard('economy-bank'), async (req, res) => {
  const settings = req.econSettings;
  const guild = await getGuild(req.params.guildId);
  const report = await econ('bank').report(req.params.guildId, settings);
  const lastBadges = await EconomyBadge.findAll({ where: { guildId: req.params.guildId, season: (Number(settings.seasonNumber) || 1) - 1 }, order: [['place', 'ASC']], raw: true });
  const users = await getUsers(lastBadges.map((b) => b.userId));
  res.render('dashboard/economy-bank', { guild, settings, report, seasonEnd: econ('seasons').endOf(settings), lastBadges, users, on: config.enabledKeys(settings), seasonParams: config.params(settings, 'seasons'), active: 'economy-bank' });
});
router.post('/:guildId/economy-bank/season-end', ensureGuildAccess, guard('economy-bank'), async (req, res) => {
  if (!config.isOn(req.econSettings, 'seasons')) return res.redirect(saved(req.params.guildId, 'economy-bank', 'invalid'));
  await econ('seasons').endSeason(req.econSettings);
  res.redirect(saved(req.params.guildId, 'economy-bank', 'seasonend'));
});
router.post('/:guildId/economy-bank/rate-reset', ensureGuildAccess, guard('economy-bank'), async (req, res) => {
  req.econSettings.econRate = 1; await req.econSettings.save();
  bridge().settingsChanged?.(req.params.guildId);
  res.redirect(saved(req.params.guildId, 'economy-bank'));
});

// ---- Treasury and server goals ----
router.get('/:guildId/economy-treasury', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const settings = req.econSettings;
  const { guildId } = req.params;
  const [guild, roles, treasury, active, goals] = await Promise.all([getGuild(guildId), getGuildRoles(guildId), ledger.treasuryOf(guildId), econ('treasury').activeMembers(guildId),
    EconomyGoal.findAll({ where: { guildId }, order: [['status', 'DESC'], ['id', 'DESC']], limit: 30, raw: true })]);
  const open = goals.filter((g) => g.status === 'open');
  const contribs = open.length ? await sequelize.query(`SELECT goalId, userId, amount FROM economy_goal_contribs WHERE goalId IN (${open.map(() => '?').join(',')}) AND amount > 0 ORDER BY amount DESC`,
    { replacements: open.map((g) => g.id), type: require('sequelize').QueryTypes.SELECT }) : [];
  const users = await getUsers([...new Set(contribs.map((c) => c.userId).filter(Boolean))]);
  res.render('dashboard/economy-treasury', { guild, settings, roles: roles.filter((r) => r.name !== '@everyone' && !r.managed), treasury, activeCount: active.length, goals, contribs, users, on: config.enabledKeys(settings), hasChannel: Boolean(settings.economyEventsChannelId), active: 'economy-treasury' });
});
router.post('/:guildId/economy-treasury/split', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const r = await econ('treasury').split(req.params.guildId, clampInt(req.body.amount, 1, 1e9, 0));
  res.redirect(saved(req.params.guildId, 'economy-treasury', r.error ? `tr_${r.error}` : 'split'));
});
router.post('/:guildId/economy-treasury/giveaway', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const r = await econ('treasury').giveaway(req.econSettings, { amount: clampInt(req.body.amount, 1, 1e9, 100), winners: clampInt(req.body.winners, 1, 20, 1), hours: clampInt(req.body.hours, 1, 336, 24) });
  res.redirect(saved(req.params.guildId, 'economy-treasury', r.error ? `tr_${r.error}` : 'trgive'));
});
router.post('/:guildId/economy-treasury/vote', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const b = req.body; const options = [];
  if (b.v_split === 'on') options.push({ kind: 'split', amount: clampInt(b.v_split_amount, 1, 1e9, 100) });
  if (b.v_give === 'on') options.push({ kind: 'giveaway', amount: clampInt(b.v_give_amount, 1, 1e9, 100), winners: clampInt(b.v_give_winners, 1, 20, 1), hours: 24 });
  if (b.v_goal === 'on' && clampInt(b.v_goal_id, 1, 2147483647, 0)) options.push({ kind: 'goal', goalId: clampInt(b.v_goal_id, 1, 2147483647, 0), amount: clampInt(b.v_goal_amount, 1, 1e9, 100) });
  if (options.length < 2) return res.redirect(saved(req.params.guildId, 'economy-treasury', 'tr_two'));
  const r = await econ('treasury').startVote(req.econSettings, options, clampInt(b.hours, 1, 168, 24));
  res.redirect(saved(req.params.guildId, 'economy-treasury', r.error ? `tr_${r.error}` : 'trvote'));
});
router.post('/:guildId/economy-treasury/goal', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const b = req.body;
  const action = ['boost', 'role', 'announce'].includes(b.action) ? b.action : 'announce';
  if (action === 'role') {
    const roleId = snowflake(b.roleId);
    if (!roleId || (await require('../../utils/roles').roleGuard(req.params.guildId, req.user?.id)).check(roleId)) return res.redirect(saved(req.params.guildId, 'economy-treasury', 'rolenotallowed'));
  }
  const r = await econ('goals').create(req.econSettings, {
    title: String(b.title || '').trim().slice(0, 80) || 'Общая цель', target: clampInt(b.target, 10, 1e9, 1000), days: clampInt(b.days, 1, 60, 7), action,
    boostMult: Math.min(3, Math.max(1.1, Number(b.boostMult) || 2)), boostHours: clampInt(b.boostHours, 1, 336, 24), roleId: snowflake(b.roleId), reward: String(b.reward || '').slice(0, 200)
  });
  res.redirect(saved(req.params.guildId, 'economy-treasury', r.error ? `goal_${r.error}` : 'goalmade'));
});
router.post('/:guildId/economy-treasury/goal/:id/fund', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const r = await econ('treasury').toGoal(req.params.guildId, clampInt(req.params.id, 1, 2147483647, 0), clampInt(req.body.amount, 1, 1e9, 0));
  res.redirect(saved(req.params.guildId, 'economy-treasury', r.ok ? 'goalfund' : `tr_${r.reason === 'treasury' ? 'treasury' : 'closed'}`));
});
router.post('/:guildId/economy-treasury/goal/:id/cancel', ensureGuildAccess, guard('economy-treasury'), async (req, res) => {
  const ok = await econ('goals').cancel(req.params.guildId, clampInt(req.params.id, 1, 2147483647, 0));
  res.redirect(saved(req.params.guildId, 'economy-treasury', ok ? 'goalcancel' : 'invalid'));
});

// ---- Deals and gift codes ----
router.get('/:guildId/economy-deals', ensureGuildAccess, guard('economy-deals'), async (req, res) => {
  const settings = req.econSettings;
  const { guildId } = req.params;
  const [guild, deals, codes] = await Promise.all([getGuild(guildId),
    EconomyDeal.findAll({ where: { guildId }, order: [[sequelize.literal("CASE status WHEN 'disputed' THEN 0 WHEN 'active' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END"), 'ASC'], ['id', 'DESC']], limit: 40, raw: true }),
    econ('gifts').list(guildId, { limit: 100 })]);
  const users = await getUsers([...new Set(deals.flatMap((d) => [d.buyerId, d.sellerId]).concat(codes.map((c) => c.redeemedBy)).filter(Boolean))]);
  res.render('dashboard/economy-deals', { guild, settings, deals, codes, users, on: config.enabledKeys(settings), giftParams: config.params(settings, 'gifts'), active: 'economy-deals' });
});
router.post('/:guildId/economy-deals/:id/resolve', ensureGuildAccess, guard('economy-deals'), async (req, res) => {
  const deal = await EconomyDeal.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId: req.params.guildId } });
  if (!deal) return res.redirect(saved(req.params.guildId, 'economy-deals', 'invalid'));
  const to = req.body.to === 'seller' ? 'seller' : 'buyer';
  const ok = await econ('deals').settle(deal, to, to === 'seller' ? 'Решение администратора в панели: деньги продавцу.' : 'Решение администратора в панели: деньги вернулись покупателю.', req.econSettings);
  if (ok) await econ('deals').refreshMessage(deal, req.econSettings).catch(() => {});
  res.redirect(saved(req.params.guildId, 'economy-deals', ok ? 'dealdone' : 'invalid'));
});
router.post('/:guildId/economy-deals/codes', ensureGuildAccess, guard('economy-deals'), async (req, res) => {
  const r = await econ('gifts').createBatch(req.params.guildId, { count: clampInt(req.body.count, 1, 100, 10), amount: clampInt(req.body.amount, 1, 1e9, 100), source: req.body.source === 'mint' ? 'mint' : 'treasury' });
  res.redirect(saved(req.params.guildId, 'economy-deals', r.error ? 'tr_treasury' : 'codes'));
});
router.post('/:guildId/economy-deals/codes/:id/revoke', ensureGuildAccess, guard('economy-deals'), async (req, res) => {
  const ok = await econ('gifts').revoke(req.params.guildId, clampInt(req.params.id, 1, 2147483647, 0));
  res.redirect(saved(req.params.guildId, 'economy-deals', ok ? 'revoked' : 'invalid'));
});
router.get('/:guildId/economy-deals/codes.csv', ensureGuildAccess, guard('economy-deals'), async (req, res) => {
  const codes = await econ('gifts').list(req.params.guildId, { limit: 5000 });
  const rows = [['code', 'amount', 'batch', 'redeemedBy', 'redeemedAt'], ...codes.filter((c) => req.query.unused === undefined || !c.redeemedBy).map((c) => [c.code, c.amount, String(c.batch || '').split(':')[0], c.redeemedBy || '', c.redeemedAt ? new Date(c.redeemedAt).toISOString() : ''])];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gift-codes-${req.params.guildId}.csv"`);
  res.send(rows.map((r) => r.join(',')).join('\n'));
});

// ---- Journal: every operation, with filters; suspicious chains; held transfers ----
router.get('/:guildId/economy-journal', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const f = { user: snowflake(req.query.user) || '', kind: ledger.KIND_LABELS[req.query.kind] ? req.query.kind : '', days: clampInt(req.query.days, 1, 365, 30), flag: req.query.flag === 'newbie' ? 'newbie' : '' };
  const where = { guildId, createdAt: { [Op.gte]: new Date(Date.now() - f.days * 86400000) } };
  if (f.user) where.userId = f.user;
  if (f.kind) where.kind = f.kind;
  if (f.flag) where.flag = f.flag;
  const page = clampInt(req.query.page, 0, 1000, 0);
  const [rows, total, suspicious, holds] = await Promise.all([
    EconomyTx.findAll({ where, order: [['id', 'DESC']], limit: 50, offset: page * 50, raw: true }),
    EconomyTx.count({ where }),
    econ('pay').suspicious(guildId, { days: 7, min: 3 }),
    EconomyHold.findAll({ where: { guildId, status: 'held' }, order: [['releaseAt', 'ASC']], limit: 50, raw: true })
  ]);
  const users = await getUsers([...new Set(rows.flatMap((r) => [r.userId, r.otherId]).concat(suspicious.map((s) => s.userId), holds.flatMap((h) => [h.fromId, h.toId])).filter((x) => x && /^\d+$/.test(x)))]);
  res.render('dashboard/economy-journal', { guild, settings, rows, total, page, f, suspicious, holds, users, KIND_LABELS: ledger.KIND_LABELS, on: config.enabledKeys(settings), active: 'economy-journal' });
});
router.post('/:guildId/economy-journal/hold/:id/return', ensureGuildAccess, async (req, res) => {
  const ok = await econ('pay').returnHold(req.params.guildId, clampInt(req.params.id, 1, 2147483647, 0));
  res.redirect(saved(req.params.guildId, 'economy-journal', ok ? 'holdback' : 'invalid'));
});

module.exports = router;
