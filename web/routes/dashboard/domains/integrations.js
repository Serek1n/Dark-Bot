// Domain: «Интеграции»: оповещения, вебхуки, отправка сообщений, события бота.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['alerts', 'webhooks', 'messages', 'events']) router.use(require('../' + page));
module.exports = router;
