// Domain: «Автоматизация»: временные голосовые, свои команды, розыгрыши, музыка, голосования, мини-игры, напоминания.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['tempVoice', 'customCommands', 'giveaways', 'music', 'modulePages']) router.use(require('../' + page));
module.exports = router;
