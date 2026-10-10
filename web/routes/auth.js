const express = require('express');
const passport = require('passport');

const router = express.Router();

router.get('/login', passport.authenticate('discord'));

router.get(
  '/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/dashboard')
);

function logout(req, res, next) {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
}
router.post('/logout', logout);
router.get('/logout', logout); // kept so old bookmarks keep working

module.exports = router;
