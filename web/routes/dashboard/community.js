// «Сообщество в каталоге»: the server's card in the public catalog (add, edit, hide, remove), its statistics and paid
// promotion with the admin's own DARK Coins. Only people who manage the server get here (ensureGuildAccess).
const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getUsers } = require('../../discordApi');
const { getSettings } = require('../../utils/common');

const router = express.Router();
const cm = () => require('../../../bot/modules/communities');
const coins = () => require('../../../bot/modules/darkCoins');
const page = (guildId, q) => `/dashboard/${guildId}/community${q ? `?${q}` : ''}`;

router.get('/:guildId/community', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, row] = await Promise.all([getGuild(guildId), getSettings(guildId), require('../../../db').Community.findOne({ where: { guildId } })]);
  const c = row ? await cm().one(row.id) : null;
  const [stats, plat, balance, mine, serverBalance, serverLog, earn] = await Promise.all([c ? cm().statsOf(c.id) : null, cm().platform(), coins().balanceOf(req.user?.id), coins().history(req.user?.id, 10),
    coins().balanceOf(coins().guildWallet(guildId)), coins().history(coins().guildWallet(guildId), 15), coins().earnSettings()]);
  const pendingServer = await require('../../../db').DarkCoinPending.sum('amount', { where: { wallet: coins().guildWallet(guildId), status: 'pending' } }) || 0;
  const [channels, reviews] = await Promise.all([getGuildChannels(guildId), c ? cm().reviewsOf(c.id, { page: req.query.rpage, all: true }) : null]);
  const users = reviews ? await getUsers(reviews.items.map((r) => r.userId)).catch(() => ({})) : {};
  res.render('dashboard/community', { guild, settings, c, stats, plat, balance, mine, serverBalance, serverLog, earn, pendingServer, key: coins().newKey(), C: cm(), active: 'community',
    channels: channels.filter((ch) => ch.type === 0 || ch.type === 5), reviews, users, chart: require('../../utils/statChart'),
    error: req.query.err ? String(req.query.err).slice(0, 200) : null, done: req.query.done || null });
});

const fail = (res, guildId, e, Cls) => { if (!Cls.some((K) => e instanceof K)) throw e; res.redirect(page(guildId, `err=${encodeURIComponent(e.message)}`)); };

router.post('/:guildId/community', ensureGuildAccess, async (req, res) => {
  try {
    await cm().save(req.params.guildId, req.user?.id, req.body);
    res.redirect(page(req.params.guildId, 'saved=1'));
  } catch (e) { fail(res, req.params.guildId, e, [cm().CommunityError]); }
});
router.post('/:guildId/community/visible', ensureGuildAccess, async (req, res) => {
  try {
    await cm().setVisible(req.params.guildId, req.body.visible === '1');
    res.redirect(page(req.params.guildId, 'saved=1'));
  } catch (e) { fail(res, req.params.guildId, e, [cm().CommunityError]); }
});
router.post('/:guildId/community/delete', ensureGuildAccess, async (req, res) => {
  try {
    await cm().remove(req.params.guildId);
    res.redirect(page(req.params.guildId, 'deleted=1'));
  } catch (e) { fail(res, req.params.guildId, e, [cm().CommunityError]); }
});
router.post('/:guildId/community/review/:rid/reply', ensureGuildAccess, async (req, res) => {
  try {
    await cm().replyReview(req.params.guildId, req.params.rid, req.user?.id, req.body.reply);
    res.redirect(page(req.params.guildId, 'done=replied') + '#reviews');
  } catch (e) { fail(res, req.params.guildId, e, [cm().CommunityError]); }
});
router.post('/:guildId/community/buy', ensureGuildAccess, async (req, res) => {
  try {
    const { duplicate } = await cm().buy(req.params.guildId, req.user?.id, String(req.body.kind || ''), req.body.days, String(req.body.key || ''), req.body.from === 'server' ? 'server' : 'me');
    res.redirect(page(req.params.guildId, `done=${duplicate ? 'dup' : 'bought'}`));
  } catch (e) { fail(res, req.params.guildId, e, [cm().CommunityError, coins().CoinError]); }
});

module.exports = router;
