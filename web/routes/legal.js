const express = require('express');

const router = express.Router();

// Date the texts were last edited. Bump it whenever the documents change.
const UPDATED = '10 октября 2026 г.';

function contact() {
  return process.env.CONTACT_INFO || 'владельцу бота в Discord (контакты указаны в описании приложения)';
}

router.get('/terms', (req, res) => res.render('legal/terms', { updated: UPDATED, contact: contact(), title: 'Условия использования' }));
router.get('/privacy', (req, res) => res.render('legal/privacy', { updated: UPDATED, contact: contact(), title: 'Политика конфиденциальности' }));

module.exports = router;
