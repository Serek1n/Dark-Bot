// Domain: «Настройки сервера» (Модули, Общие), «Обновления» и главная страница.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['overview', 'features', 'changelog', 'access']) router.use(require('../' + page));
module.exports = router;
