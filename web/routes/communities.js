// The public catalog «Сообщества DARK»: anyone can browse it; voting and complaints need a Discord sign-in.
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const cm = () => require('../../bot/modules/communities');
const voteLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Слишком много запросов. Подождите минуту.' });
const visitor = (req) => req.user?.id || require('crypto').createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16);

router.get('/', async (req, res) => {
  const f = {
    q: String(req.query.q || '').slice(0, 60), category: cm().CATEGORY[req.query.category] ? req.query.category : '', sort: cm().SORTS[req.query.sort] ? req.query.sort : 'popular',
    tag: String(req.query.tag || '').toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 20), size: cm().SIZES[req.query.size] ? req.query.size : '',
    min: ['3', '4'].includes(String(req.query.min)) ? String(req.query.min) : '', fav: req.query.fav === '1' && req.user?.id ? '1' : ''
  };
  const favs = await cm().favoriteIds(req.user?.id);
  const data = await cm().catalog({ ...f, minRating: Number(f.min) || 0, favIds: f.fav ? favs : null, page: req.query.page });
  data.items.forEach((c) => { c.fav = favs.has(c.id); });
  res.render('communities/index', { title: 'Сообщества', ...data, f, C: cm(), favCount: favs.size });
});

// the catalog's pictures kept by the bot (bot/modules/communityMedia.js): WebP only, cached for a month
router.get('/media/:gid(\\d{15,25})/:file([a-f0-9]{20}\\.webp)', (req, res) => {
  const media = require('../../bot/modules/communityMedia');
  const file = media.fileOf(`/communities/media/${req.params.gid}/${req.params.file}`);
  if (!file) return res.status(404).end();
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// A listing that is not published (waiting for checking, hidden) is still shown to those who decide on it or own it:
// the platform owners — to moderate it — and the admins of its server, as a preview. Everyone else gets 404.
function mayPreview(req, c) {
  if (!req.user) return false;
  if (require('../../bot/modules/darkCoins').isPlatformOwner(req.user.id)) return true;
  if (c.status === 'blocked') return false;
  if (c.ownerId === req.user.id) return true;
  const { hasManageAccess } = require('../utils/common');
  return (req.user.guilds || []).some((g) => g.id === c.guildId && hasManageAccess(g));
}

router.get('/:id(\\d+)', async (req, res) => {
  const c = await cm().one(req.params.id);
  if (c && cm().adultServer(c.guildId) && !mayPreview(req, c)) return res.status(404).render('error', { message: 'Сообщество не найдено или скрыто.' }); // 18+: not for everybody
  const preview = Boolean(c && c.status !== 'published' && mayPreview(req, c));
  if (!c || (c.status !== 'published' && !preview)) return res.status(404).render('error', { message: 'Сообщество не найдено или скрыто.' });
  if (!preview) await cm().view(c.id, visitor(req)).catch(() => {});
  const [reviews, extra, similar, favs] = await Promise.all([cm().reviewsOf(c.id, { page: req.query.rpage, userId: req.user?.id }), cm().liveExtra(c), cm().similar(c), cm().favoriteIds(req.user?.id)]);
  const users = await require('../discordApi').getUsers([...new Set(reviews.items.map((r) => r.userId).concat(reviews.mine ? [reviews.mine.userId] : []))]).catch(() => ({}));
  const MSG = { voted: 'voted', reported: 'reported', reviewed: 'reviewed', unreviewed: 'unreviewed', rreported: 'rreported', faved: 'faved', unfaved: 'unfaved' };
  const msg = Object.keys(MSG).find((k) => req.query[k]) || null;
  res.render('communities/show', { title: c.name, c, C: cm(), preview, platformOwner: Boolean(res.locals.platformQueue), reviews, extra, similar, users, fav: favs.has(c.id), msg, error: req.query.err ? String(req.query.err).slice(0, 200) : null, base: (process.env.WEB_BASE_URL || '').replace(/\/+$/, '') });
});

// «Присоединиться»: counted, then to the server's invite
router.get('/:id(\\d+)/join', async (req, res) => {
  const c = await cm().one(req.params.id);
  if (!c || c.status !== 'published') return res.status(404).render('error', { message: 'Сообщество не найдено или скрыто.' });
  await cm().click(c.id, visitor(req)).catch(() => {});
  if (req.user?.id) await cm().joinIntent(c, req.user.id, req.ip).catch(() => {});
  res.redirect(c.inviteUrl);
});

const back = (id, flag, err) => `/communities/${id}?${err ? `err=${encodeURIComponent(err)}` : `${flag}=1`}`;
router.post('/:id(\\d+)/vote', signedIn, voteLimit, async (req, res) => {
  try {
    await cm().vote(req.params.id, req.user.id, req.ip);
    res.redirect(back(req.params.id, 'voted'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(back(req.params.id, null, e.message));
  }
});
router.post('/:id(\\d+)/report', signedIn, voteLimit, async (req, res) => {
  try {
    await cm().report(req.params.id, req.user.id, req.body.reason);
    res.redirect(back(req.params.id, 'reported'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(back(req.params.id, null, e.message));
  }
});

// reviews: write / change, delete one's own, complain about someone's
const handle = (fn, flag, anchor = '') => async (req, res) => {
  try {
    await fn(req);
    res.redirect(back(req.params.id, flag) + anchor);
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(back(req.params.id, null, e.message) + anchor);
  }
};
router.post('/:id(\\d+)/review', signedIn, voteLimit, handle((req) => cm().saveReview(req.params.id, req.user.id, { rating: req.body.rating, text: req.body.text }), 'reviewed', '#reviews'));
router.post('/:id(\\d+)/review/delete', signedIn, voteLimit, handle((req) => cm().deleteReview(req.params.id, req.user.id), 'unreviewed', '#reviews'));
router.post('/:id(\\d+)/review/:rid(\\d+)/report', signedIn, voteLimit, handle((req) => cm().reportReview(req.params.rid, req.user.id, req.body.reason), 'rreported', '#reviews'));
router.post('/:id(\\d+)/favorite', signedIn, voteLimit, async (req, res) => {
  try {
    const on = await cm().toggleFavorite(req.user.id, req.params.id);
    // from the catalog: back to the same list; from the page: back to the page
    const from = String(req.body.from || '');
    if (/^\/communities(\?[^\s<>"]*)?$/.test(from)) return res.redirect(from);
    res.redirect(back(req.params.id, on ? 'faved' : 'unfaved'));
  } catch (e) {
    if (!(e instanceof cm().CommunityError)) throw e;
    res.redirect(back(req.params.id, null, e.message));
  }
});

module.exports = router;
