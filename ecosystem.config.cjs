// PM2: rulează pe același VPS ca PredictCamp, fără să atingă procesele existente.
module.exports = {
  apps: [
    {
      name: 'predictbot-api',
      cwd: '/var/www/predictbot',
      script: 'src/bin/serve.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
    {
      name: 'predictbot-crawler',
      cwd: '/var/www/predictbot',
      script: 'src/cron/botPredictCrawler.js',
      autorestart: false,
      cron_restart: '0 6 * * *',
      env: { NODE_ENV: 'production' },
    },
  ],
};
