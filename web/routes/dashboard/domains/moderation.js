// Domain: «Модерация»: наказания, автомодерация, логи сервера, тикеты.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['moderation', 'automod', 'logs', 'tickets']) router.use(require('../' + page));
module.exports = router;
