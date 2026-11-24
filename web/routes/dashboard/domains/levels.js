// Domain: «Уровни»: начисление, роли за уровни, множители, уведомления, лидерборд, данные.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['leveling', 'levelRoles', 'channelBoosts']) router.use(require('../' + page));
module.exports = router;
