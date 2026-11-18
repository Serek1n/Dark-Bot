// The public catalog «Сообщества DARK»: anyone can browse it; voting and complaints need a Discord sign-in.
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const cm = () => require('../../bot/modules/communities');
const voteLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Слишком много запросов. Подождите минуту.' });
const visitor = (req) => req.user?.id || require('crypto').createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16);

router.get('/', async (req, res) => {
  const f = { q: String(req.query.q || '').slice(0, 60), category: cm().CATEGORY[req.query.category] ? req.query.category : '', sort: cm().SORTS[req.query.sort] ? req.query.sort : 'popular' };
  const data = await cm().catalog({ ...f, page: req.query.page });
  res.render('communities/index', { title: 'Сообщества', ...data, f, C: cm() });
});

router.get('/:id(\\d+)', async (req, res) => {
  const c = await cm().one(req.params.id);
  if (!c || c.status !== 'published') return res.status(404).render('error', { message: 'Сообщество не найдено или скрыто.' });
  await cm().view(c.id, visitor(req)).catch(() => {});
  res.render('communities/show', { title: c.name, c, C: cm(), msg: req.query.voted ? 'voted' : req.query.reported ? 'reported' : null, error: req.query.err ? String(req.query.err).slice(0, 200) : null });
});

// «Присоединиться»: counted, then to the server's invite
router.get('/:id(\\d+)/join', async (req, res) => {
  const c = await cm().one(req.params.id);
  if (!c || c.status !== 'published') return res.status(404).render('error', { message: 'Сообщество не найдено или скрыто.' });
  await cm().click(c.id).catch(() => {});
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

module.exports = router;
