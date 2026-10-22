// ONE process: the bot and the web panel run together (bot/index.js starts the panel after login).
// To run the panel on its own add an app with script ./web/index.js and set WEB_ENABLED=false for the bot.
module.exports = {
  apps: [
    {
      name: 'dark-bot',
      script: './bot/index.js',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
