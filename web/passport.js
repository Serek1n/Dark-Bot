const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');

const { encrypt } = require('../db/crypto');

// Only what the panel uses goes into the session (the full Discord profile with every server's feature list is tens of KB,
// read and written on every request). The OAuth tokens are stored encrypted: a copy of the session table does not give them away.
const slimGuilds = (guilds) => (Array.isArray(guilds) ? guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: Boolean(g.owner), permissions: g.permissions })) : []);
function slimUser(p) {
  return {
    id: p.id, username: p.username, global_name: p.global_name || null, avatar: p.avatar || null,
    guilds: slimGuilds(p.guilds), guildsAt: p.guildsAt, guildsOkAt: p.guildsOkAt,
    accessToken: encrypt(p.accessToken), refreshToken: encrypt(p.refreshToken)
  };
}

passport.serializeUser((user, done) => done(null, slimUser(user)));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: `${process.env.WEB_BASE_URL}/auth/callback`,
      scope: ['identify', 'guilds'],
      state: true // a random value kept in the session and checked on return: a sign-in cannot be forced from another site
    },
    (accessToken, refreshToken, profile, done) => {
      // profile.guilds contains guilds the user is in, with `permissions` bitfield we use
      // to filter down to "Manage Server" guilds in the dashboard route.
      // Kept to re-read the server list later (see web/utils/userGuilds.js).
      profile.accessToken = accessToken;
      profile.refreshToken = refreshToken;
      profile.guildsAt = Date.now();
      profile.guildsOkAt = Date.now();
      done(null, profile);
    }
  )
);

module.exports = passport;
module.exports.slimGuilds = slimGuilds;
module.exports.slimUser = slimUser;
