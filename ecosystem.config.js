module.exports = {
  apps: [
    {
      name: 'dark-bot',
      script: './bot/index.js',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'dark-web',
      script: './web/index.js',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
