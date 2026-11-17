// «Достижения»: overview with statistics, the catalog (built-in on/off, the server's own: create, edit, delete), members
// (progress of one member, give and take by hand), settings (where the cards go, the balance goal). A preview of the card.
const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, getUsers } = require('../../discordApi');
const { Achievement, MemberAchievement, sequelize } = require('../../../db');
const { clampInt, snowflake, saved, getSettings } = require('../../utils/common');
const { roleGuard } = require('../../utils/roles');
const { pickChannels, noPerm } = require('../../utils/channels');
const { getClient } = require('../../botBridge');

const router = express.Router();
const ach = () => require('../../../bot/modules/achievements');
const MAX_OWN = 100; // a server's own achievements

async function base(req, page) {
  const { guildId } = req.params;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const list = await ach().catalog(guildId, settings);
  return { guild, settings, list, active: page, A: ach() };
}
const pct = (n, members) => (members ? Math.round((n / members) * 1000) / 10 : 0);

// ---- Обзор ----
router.get('/:guildId/achievements', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'achievements');
  const st = await ach().stats(req.params.guildId);
  const counted = await require('../../../db').MemberProfile.count({ where: { guildId: req.params.guildId } });
  const enabled = data.list.filter((a) => a.enabled);
  const ranked = enabled.map((a) => ({ a, n: st.byKey[a.key] || 0 })).sort((x, y) => y.n - x.n);
  const users = await getUsers(st.recent.map((r) => r.userId));
  res.render('dashboard/achievements', { ...data, st, counted, enabled, top: ranked.slice(0, 6), rare: ranked.filter((x) => x.n > 0).reverse().slice(0, 6), users, pct });
});

// ---- Каталог ----
router.get('/:guildId/achievements-catalog', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'achievements-catalog');
  const st = await ach().stats(req.params.guildId);
  const counted = await require('../../../db').MemberProfile.count({ where: { guildId: req.params.guildId } });
  const f = {
    cat: ach().CATEGORY[req.query.cat] ? req.query.cat : '',
    rarity: ach().RARITY[req.query.rarity] ? req.query.rarity : '',
    type: ['builtin', 'own'].includes(req.query.type) ? req.query.type : '',
    state: ['on', 'off'].includes(req.query.state) ? req.query.state : ''
  };
  const shown = data.list.filter((a) => (!f.cat || a.category === f.cat) && (!f.rarity || a.rarity === f.rarity)
    && (!f.type || (f.type === 'builtin') === a.builtin) && (!f.state || (f.state === 'on') === a.enabled));
  res.render('dashboard/achievements-catalog', { ...data, shown, f, st, counted, pct, own: data.list.filter((a) => !a.builtin).length, MAX_OWN });
});

// A built-in one on or off.
router.post('/:guildId/achievements/builtin', ensureGuildAccess, async (req, res) => {
  const key = String(req.body.key || '');
  if (!ach().BUILTIN_BY_KEY.has(key)) return res.redirect(saved(req.params.guildId, 'achievements-catalog', 'invalid'));
  const settings = await getSettings(req.params.guildId);
  const off = ach().offList(settings);
  if (req.body.on === '1') off.delete(key); else off.add(key);
  settings.achievementsOff = JSON.stringify([...off]);
  await settings.save();
  res.redirect(`/dashboard/${req.params.guildId}/achievements-catalog?saved=1${req.body.back ? `&${String(req.body.back).replace(/[^a-z=&]/g, '')}` : ''}`);
});

// ---- Создать / изменить ----
router.get('/:guildId/achievements-edit', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'achievements-edit');
  const { guildId } = req.params;
  const id = Number(req.query.id) || null;
  const row = id ? await Achievement.findOne({ where: { id, guildId } }) : null;
  if (id && !row) return res.redirect(`/dashboard/${guildId}/achievements-catalog`);
  const [allRoles, guard] = await Promise.all([getGuildRoles(guildId), roleGuard(guildId, req.user?.id)]);
  const it = row ? ach().fromRow(row) : { name: '', description: '', emoji: '🏆', imageUrl: '', category: 'special', rarity: 'common', condType: 'manual', value: 0, roleId: null, reward: { coins: 0, crystals: 0, roleId: null }, enabled: true, hidden: false };
  const own = data.list.filter((a) => !a.builtin).length;
  res.render('dashboard/achievements-edit', { ...data, it, id, roles: guard.annotate(allRoles), allRoles, own, MAX_OWN });
});

const IMAGE_RE = /^https:\/\/[^\s"'<>]{4,390}$/i;
router.post('/:guildId/achievements/save', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const b = req.body;
  const id = Number(b.id) || null;
  const row = id ? await Achievement.findOne({ where: { id, guildId } }) : null;
  if (id && !row) return res.redirect(saved(guildId, 'achievements-catalog', 'invalid'));
  if (!row && (await Achievement.count({ where: { guildId } })) >= MAX_OWN) return res.redirect(saved(guildId, 'achievements-catalog', 'achlimit'));
  const A = ach();
  const name = String(b.name || '').trim().slice(0, 80);
  const condType = A.COND_TYPES.includes(b.condType) ? b.condType : 'manual';
  const imageUrl = String(b.imageUrl || '').trim();
  const back = id ? `achievements-edit?id=${id}&` : 'achievements-edit?';
  if (!name || (imageUrl && !IMAGE_RE.test(imageUrl))) return res.redirect(`/dashboard/${guildId}/${back}invalid=1`);
  const condRoleId = condType === 'role' ? snowflake(b.condRoleId) : null;
  if (condType === 'role' && !condRoleId) return res.redirect(`/dashboard/${guildId}/${back}invalid=1`);
  // a reward role must be one the bot may give and this admin may hand out
  const rewardRoleId = snowflake(b.rewardRoleId);
  if (rewardRoleId && rewardRoleId !== row?.rewardRoleId && (await roleGuard(guildId, req.user?.id)).check(rewardRoleId)) return res.redirect(`/dashboard/${guildId}/${back}rolenotallowed=1`);
  const fields = {
    name,
    description: String(b.description || '').trim().slice(0, 200),
    emoji: String(b.emoji || '').trim().slice(0, 64) || '🏆',
    imageUrl: imageUrl || null,
    category: A.CATEGORY[b.category] ? b.category : 'special',
    rarity: A.RARITY[b.rarity] ? b.rarity : 'common',
    condType,
    condValue: ['role', 'manual'].includes(condType) ? 0 : clampInt(b.condValue, 1, 1e9, 1),
    condRoleId,
    rewardCoins: clampInt(b.rewardCoins, 0, 1e7, 0),
    rewardCrystals: clampInt(b.rewardCrystals, 0, 1e6, 0),
    rewardRoleId,
    enabled: b.enabled === 'on',
    hidden: b.hidden === 'on'
  };
  if (row) await row.update(fields);
  else await Achievement.create({ ...fields, guildId, createdBy: req.user?.id || null });
  res.redirect(saved(guildId, 'achievements-catalog'));
});

router.post('/:guildId/achievements/:id/delete', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const row = await Achievement.findOne({ where: { id: Number(req.params.id) || 0, guildId } });
  if (row) {
    await sequelize.transaction(async (t) => {
      await MemberAchievement.destroy({ where: { guildId, key: `c${row.id}` }, transaction: t });
      await row.destroy({ transaction: t });
    });
  }
  res.redirect(saved(guildId, 'achievements-catalog', 'deleted'));
});

// The card as members will see it (for the editor's preview).
router.get('/:guildId/achievements/card/:key.png', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const a = (await ach().catalog(guildId, settings)).find((x) => x.key === req.params.key);
  if (!a) return res.status(404).end();
  const png = await ach().renderCard({ achievement: a, userName: req.user?.username || 'Участник', avatarUrl: null });
  res.set('Content-Type', 'image/png').set('Cache-Control', 'private, max-age=30').send(png);
});

// ---- Участники ----
router.get('/:guildId/achievements-members', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'achievements-members');
  const { guildId } = req.params;
  const top = await MemberAchievement.findAll({ where: { guildId }, attributes: ['userId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['userId'], order: [[sequelize.literal('n'), 'DESC']], limit: 25, raw: true });
  const userId = snowflake(String(req.query.user || '').replace(/[<@!>]/g, ''));
  let view = null;
  if (userId) {
    const guildObj = getClient()?.guilds?.cache?.get(guildId) || { id: guildId };
    const member = guildObj.members ? await guildObj.members.fetch(userId).catch(() => null) : null;
    view = await ach().memberView(guildObj, userId, member);
  }
  const users = await getUsers([...top.map((t) => t.userId), ...(userId ? [userId] : [])]);
  res.render('dashboard/achievements-members', { ...data, top, userId, view, users, enabledCount: data.list.filter((a) => a.enabled && !a.hidden).length, bad: req.query.user && !userId });
});

router.post('/:guildId/achievements/grant', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  const settings = await getSettings(guildId);
  const a = (await ach().catalog(guildId, settings)).find((x) => x.key === req.body.key);
  if (!userId || !a) return res.redirect(saved(guildId, 'achievements-members', 'invalid'));
  const guildObj = getClient()?.guilds?.cache?.get(guildId);
  const got = await ach().grant(guildObj || { id: guildId }, userId, a, req.user?.id || null);
  if (got && guildObj) {
    const member = await guildObj.members.fetch(userId).catch(() => null);
    await ach().notify(guildObj, member, userId, [a], settings, null).catch(() => {});
  }
  res.redirect(`/dashboard/${guildId}/achievements-members?user=${userId}&${got ? 'granted' : 'already'}=1`);
});

router.post('/:guildId/achievements/revoke', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const userId = snowflake(req.body.userId);
  if (!userId) return res.redirect(saved(guildId, 'achievements-members', 'invalid'));
  await ach().revoke(guildId, userId, String(req.body.key || '').slice(0, 40));
  res.redirect(`/dashboard/${guildId}/achievements-members?user=${userId}&taken=1`);
});

// ---- Настройки ----
router.get('/:guildId/achievements-settings', ensureGuildAccess, async (req, res) => {
  const data = await base(req, 'achievements-settings');
  res.render('dashboard/achievements-settings', { ...data, channels: await getGuildChannels(req.params.guildId) });
});
router.post('/:guildId/achievements/settings', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  settings.achievementsNotify = ['auto', 'channel', 'dm', 'off'].includes(req.body.achievementsNotify) ? req.body.achievementsNotify : 'auto';
  settings.achievementsBalanceGoal = clampInt(req.body.achievementsBalanceGoal, 1, 1e9, 10000);
  const missing = await pickChannels(req.body, settings, guildId, { achievementsChannelId: 'post' });
  await settings.save();
  res.redirect(missing.length ? noPerm(guildId, 'achievements-settings', missing) : saved(guildId, 'achievements-settings'));
});

module.exports = router;
