// Domain: «Участники и роли»: приветствие, автороль и возврат, роли по реакциям, сообщения с кнопками.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['welcome', 'reactionRoles', 'interactive']) router.use(require('../' + page));
module.exports = router;
