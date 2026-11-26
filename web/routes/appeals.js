// The public appeal pages: anyone signed in with Discord sees HIS punishments in force (on every server with appeals on),
// files an appeal against one of them and follows its status. Being on the server is not needed — a banned person can use it.
const express = require('express');
const { getGuild } = require('../discordApi');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const ap = () => require('../../bot/modules/appeals');
const db = () => require('../../db');
const ag = () => require('../../bot/modules/appealGuild');

const { signedIn } = require('../middleware/ensureAuth');
const fileLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: 'Слишком много попыток подать апелляцию. Подождите 10 минут.' });

async function guildsOf(ids) {
  const out = {};
  await Promise.all([...new Set(ids)].map(async (id) => { out[id] = await getGuild(id).catch(() => null) || { id, name: `Сервер ${id}`, icon: null }; }));
  return out;
}

router.get('/', signedIn, async (req, res) => {
  const me = req.user.id;
  const [punishments, appeals, passes] = await Promise.all([ap().punishmentsOf(me), db().Appeal.findAll({ where: { userId: me }, order: [['id', 'DESC']], limit: 50 }), ag().passesOf(me)]);
  const guilds = await guildsOf([...punishments.map((p) => p.guildId), ...appeals.map((a) => a.guildId)]);
  // the appeal server of each punishment's server: its mode, and a live invite shown once (for closed DMs)
  const doors = {};
  for (const gid of [...new Set(punishments.map((p) => p.guildId))]) {
    const c = ag().cfgOf(await require('../../bot/modules/leveling').getOrCreateSettings(gid));
    if (!c.on || !punishments.some((p) => p.guildId === gid && c.kinds.includes(p.kind))) continue;
    const pass = passes[gid] || null;
    doors[gid] = { mode: c.mode, pass, invite: pass && await ag().showOnce(pass) ? ag().inviteUrl(pass) : null };
  }
  res.render('appeals/index', { title: 'Апелляции', punishments, appeals, guilds, doors, A: ap(), sent: req.query.sent === '1', flash: String(req.query.pass || ''), passWhy: req.query.why ? String(req.query.why).slice(0, 200) : '' });
});

router.get('/new', signedIn, async (req, res) => {
  let p = null; let error = null;
  try { p = await ap().ownPunishment(req.user.id, { guildId: String(req.query.g || ''), kind: String(req.query.kind || ''), id: Number(req.query.id) }); } catch (e) { error = e.message; }
  if (p?.open) return res.redirect(`/appeals/${p.open.id}`);
  const guilds = p ? await guildsOf([p.guildId]) : {};
  const settings = p ? await require('../../bot/modules/leveling').getOrCreateSettings(p.guildId) : null;
  res.render('appeals/new', { title: 'Новая апелляция', p, error, guild: p ? guilds[p.guildId] : null, A: ap(), links: settings ? settings.appealsLinks !== false && settings.appealsLinks !== 0 : false, form: {} });
});

router.post('/', signedIn, fileLimit, async (req, res) => {
  const b = req.body;
  try {
    const appeal = await ap().create(req.user.id, { guildId: String(b.g || ''), kind: String(b.kind || ''), id: Number(b.id), text: b.text, links: b.links });
    res.redirect(`/appeals/${appeal.id}?sent=1`);
  } catch (e) {
    if (!(e instanceof ap().AppealError)) throw e;
    let p = null;
    try { p = await ap().ownPunishment(req.user.id, { guildId: String(b.g || ''), kind: String(b.kind || ''), id: Number(b.id) }); } catch { /* shown as the error */ }
    const guilds = p ? await guildsOf([p.guildId]) : {};
    res.status(400).render('appeals/new', { title: 'Новая апелляция', p, error: e.message, guild: p ? guilds[p.guildId] : null, A: ap(), links: true, form: { text: String(b.text || '').slice(0, 2000), links: String(b.links || '').slice(0, 600) } });
  }
});

// «Запросить вход на сервер апелляций» (moderator mode) or «Получить приглашение» (instant mode, e.g. the DMs were closed)
router.post('/pass', signedIn, fileLimit, async (req, res) => {
  try {
    const r = await ag().request(req.user.id, String(req.body.g || ''), { comment: req.body.comment });
    res.redirect(`/appeals?pass=${r.issued ? 'issued' : 'requested'}`);
  } catch (e) {
    if (!(e instanceof ap().AppealError)) throw e;
    res.redirect(`/appeals?pass=err&why=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
});

// The author answers the moderator's question
router.post('/:id(\\d+)/reply', signedIn, fileLimit, async (req, res) => {
  try {
    await ap().reply(Number(req.params.id), req.user.id, req.body.text);
    res.redirect(`/appeals/${Number(req.params.id)}?replied=1`);
  } catch (e) {
    if (!(e instanceof ap().AppealError)) throw e;
    res.redirect(`/appeals/${Number(req.params.id)}?err=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
});

// One appeal: only its author sees it here (moderators read it in the panel).
router.get('/:id(\\d+)', signedIn, async (req, res) => {
  const appeal = await db().Appeal.findOne({ where: { id: Number(req.params.id), userId: req.user.id } });
  if (!appeal) return res.status(404).render('error', { message: 'Апелляция не найдена.' });
  const notes = await db().AppealNote.findAll({ where: { appealId: appeal.id, visible: true }, order: [['id', 'ASC']] });
  const guilds = await guildsOf([appeal.guildId]);
  res.render('appeals/show', { title: `Апелляция #${appeal.id}`, appeal, notes, guild: guilds[appeal.guildId], A: ap(), sent: req.query.sent === '1', replied: req.query.replied === '1', error: req.query.err ? String(req.query.err).slice(0, 200) : null });
});

module.exports = router;
