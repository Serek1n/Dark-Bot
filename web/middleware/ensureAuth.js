function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

module.exports = { ensureAuth };
