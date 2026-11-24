// Domain: «Сообщество»: достижения, карточка в каталоге, статистика сервера, оформление, заменители.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['achievements', 'community', 'serverStats', 'appearance', 'replacers']) router.use(require('../' + page));
module.exports = router;
