// ONE process: the bot and the web panel run together (bot/index.js starts the panel after login).
// To run the panel on its own add an app with script ./web/index.js and set WEB_ENABLED=false for the bot.
module.exports = {
  apps: [
    {
      name: 'dark-bot',
      script: './bot/index.js',
      env: { NODE_ENV: 'production' },
      // After a crash wait a little longer each time (up to 15 s) and never give up: a long Discord outage must not leave the bot stopped.
      exp_backoff_restart_delay: 2000,
      kill_timeout: 10000 // time for a clean stop: voice time is written, the database is closed
    }
  ]
};
