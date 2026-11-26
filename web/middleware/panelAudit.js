// A line in the log for every change made through the panel: who, where, what. Never the form contents
// (they can hold links of webhooks or other secrets).
const logger = require('../../bot/utils/logger');

function panelAudit(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/(webhooks\/)\d+/, '$1<id>');
    logger.info(`Panel: user=${req.user?.id || '-'} ${req.method} ${path} -> ${res.statusCode}`);
    // a change made with delegated rights (not the owner or an administrator) goes into the server's panel log too
    const m = /^\/dashboard\/(\d{15,25})(\/.*)?$/.exec(path);
    if (m && req.access && !req.access.full && res.statusCode < 400 && !/^\/access/.test(m[2] || '')) {
      require('../utils/audit').record(m[1], req.user?.id || null, 'change', `${req.method} ${m[2] || '/'}`).catch(() => {});
    }
  });
  next();
}

module.exports = { panelAudit };
