const express = require('express');
const { ensureAuth } = require('../../middleware/ensureAuth');
require('../../modules'); // the templates read the modules (global.__darkModules) even when the app did not load them

// The panel, one file per page. Every file defines its own full paths (/:guildId/...), so the order here only matters for the first one.
const router = express.Router();
router.use(ensureAuth);

// Search over the settings of all pages (headings, fields, switches) for the "Поиск" box; the same for every server.
router.get('/settings-index.json', (req, res) => {
  const { settingsIndex } = require('../../settingsIndex');
  let pages = settingsIndex();
  if (req.lang === 'en') {
    const { toEnglish } = require('../../../i18n');
    pages = pages.map((p) => ({ ...p, title: toEnglish(p.title, true), entries: p.entries.map((e) => ({ ...e, text: toEnglish(e.text, true) })) }));
  }
  res.set('Cache-Control', 'private, max-age=600');
  res.json({ pages });
});

// Any change an admin makes on a server's pages: the home page's numbers are counted afresh next time.
router.post('/:guildId/*', (req, res, next) => { require('../../modules').forgetStats(req.params.guildId); next(); });
router.patch('/:guildId/*', (req, res, next) => { require('../../modules').forgetStats(req.params.guildId); next(); });

// Addresses of the sections by their names in the plan of the panel (and old ones): they lead to the page that has it now.
const ALIASES = { levels: 'leveling', 'channel-bonuses': 'channel-boosts', multipliers: 'channel-boosts', members: 'welcome', automation: 'temp-voice', 'server-settings': 'settings', modules: 'features', integrations: 'alerts' };
router.get('/:guildId/:alias', (req, res, next) => {
  const to = ALIASES[req.params.alias];
  if (!to || !/^\d{15,25}$/.test(req.params.guildId)) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(301, `/dashboard/${req.params.guildId}/${to}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
});

for (const page of [
  'api', 'overview', 'leveling', 'features', 'economy', 'shop', 'moderation', 'logs', 'automod', 'channelBoosts', 'welcome',
  'levelRoles', 'reactionRoles', 'customCommands', 'tempVoice', 'alerts', 'webhooks', 'changelog', 'replacers', 'interactive', 'giveaways', 'messages', 'events', 'music', 'achievements', 'community', 'appearance', 'serverStats'
]) {
  router.use(require('./' + page));
}

module.exports = router;
