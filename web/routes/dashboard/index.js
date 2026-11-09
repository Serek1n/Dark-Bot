const express = require('express');
const { ensureAuth } = require('../../middleware/ensureAuth');

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

for (const page of [
  'overview', 'leveling', 'features', 'economy', 'shop', 'moderation', 'logs', 'automod', 'channelBoosts', 'welcome',
  'levelRoles', 'reactionRoles', 'customCommands', 'tempVoice', 'alerts', 'webhooks', 'changelog', 'starboard', 'replacers', 'interactive', 'giveaways', 'messages'
]) {
  router.use(require('./' + page));
}

module.exports = router;
