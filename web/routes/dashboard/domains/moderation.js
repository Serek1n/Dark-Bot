// Domain: «Модерация»: наказания, автомодерация, логи сервера.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['moderation', 'automod', 'logs']) router.use(require('../' + page));
module.exports = router;
