function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

/** For the public pages (appeals, communities): signed in, else to Discord and back to this very page. */
function signedIn(req, res, next) {
  if (req.isAuthenticated?.()) return next();
  const back = req.method === 'GET' ? req.originalUrl : (req.get('referer') ? new URL(req.get('referer'), 'http://x').pathname : '/');
  res.redirect(`/auth/login?next=${encodeURIComponent(back)}`);
}

module.exports = { ensureAuth, signedIn };
