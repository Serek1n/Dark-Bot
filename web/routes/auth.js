const express = require('express');
const passport = require('passport');

const router = express.Router();

// ?next=/appeals… : where to come back after signing in. Only the public pages (appeals, communities, the platform page) are
// accepted — never another site.
const safeNext = (v) => (typeof v === 'string' && /^\/(appeals(\/\d{1,10}|\/new)?|communities(\/\d{1,10})?|platform|wallet)(\?[\w=&%.-]{0,200})?$/.test(v) ? v : null);
router.get('/login', (req, res, next) => {
  const to = safeNext(req.query.next);
  if (to && req.session) req.session.returnTo = to;
  next();
}, passport.authenticate('discord'));

router.get(
  '/callback',
  passport.authenticate('discord', { failureRedirect: '/', keepSessionInfo: true }),
  (req, res) => {
    const to = safeNext(req.session?.returnTo);
    if (req.session) delete req.session.returnTo;
    res.redirect(to || '/dashboard');
  }
);

/** The Discord token of this session stops working at Discord too, not only here. Best effort: never holds the logout up. */
function revokeToken(user) {
  try {
    const { decrypt } = require('../../db/crypto');
    const token = user?.accessToken ? decrypt(user.accessToken) : null;
    if (!token || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return;
    const body = new URLSearchParams({ token, token_type_hint: 'access_token', client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET });
    require('axios').post('https://discord.com/api/oauth2/token/revoke', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }).catch(() => {});
  } catch { /* nothing to revoke */ }
}

function logout(req, res, next) {
  revokeToken(req.user);
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
}
router.post('/logout', logout);
// Logging out is POST only: a link on another site must not be able to sign an admin out.

module.exports = router;
module.exports.safeNext = safeNext;
