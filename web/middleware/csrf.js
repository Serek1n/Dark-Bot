// CSRF guard: a request that changes something must come from this very site.
// Browsers always send Origin (or at least Referer) on a form post, so a request with neither, with
// "Origin: null" or with a foreign address is refused. SameSite=Lax on the cookie is the second line of defence.
function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const source = req.get('origin') || req.get('referer');
  if (source) {
    try {
      const from = new URL(source);
      const host = String(req.get('host') || '');
      const ownHost = (() => { try { return new URL(process.env.WEB_BASE_URL).host; } catch (_) { return null; } })();
      // Host and port must both match (another service on this machine, e.g. :8080, is a different site). Behind nginx that
      // strips the port from Host, the address in WEB_BASE_URL is the one accepted.
      if (from.host === host || (ownHost && from.host === ownHost)) return next();
    } catch (_) { /* unreadable address: refuse below */ }
  }
  return res.status(403).render('error', { message: 'Запрос отклонён: он не похож на отправленный с этого сайта. Обновите страницу и повторите.' });
}

module.exports = { csrfGuard };
