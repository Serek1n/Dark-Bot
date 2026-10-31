const express = require('express');
const { ensureAuth } = require('../../middleware/ensureAuth');

// The panel, one file per page. Every file defines its own full paths (/:guildId/...), so the order here only matters for the first one.
const router = express.Router();
router.use(ensureAuth);

for (const page of [
  'overview', 'leveling', 'features', 'economy', 'shop', 'moderation', 'logs', 'automod', 'channelBoosts', 'welcome',
  'levelRoles', 'reactionRoles', 'customCommands', 'tempVoice', 'alerts', 'webhooks', 'changelog', 'starboard', 'replacers', 'interactive'
]) {
  router.use(require('./' + page));
}

module.exports = router;
