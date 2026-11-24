// Domain: «Экономика»: валюты, магазин, центробанк, казна, сделки, журнал.
// The pages of one section of the panel; each page file keeps its own full paths (/:guildId/…).
const router = require('express').Router();
for (const page of ['economy', 'shop']) router.use(require('../' + page));
module.exports = router;
