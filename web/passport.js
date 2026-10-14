const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: `${process.env.WEB_BASE_URL}/auth/callback`,
      scope: ['identify', 'guilds']
    },
    (accessToken, refreshToken, profile, done) => {
      // profile.guilds contains guilds the user is in, with `permissions` bitfield we use
      // to filter down to "Manage Server" guilds in the dashboard route.
      // Kept to re-read the server list later (see web/utils/userGuilds.js).
      profile.accessToken = accessToken;
      profile.refreshToken = refreshToken;
      profile.guildsAt = Date.now();
      done(null, profile);
    }
  )
);

module.exports = passport;
