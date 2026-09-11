// PM2 process config for production.
//
//   pm2 start ecosystem.config.cjs   # start (NODE_ENV=production)
//   pm2 save                         # remember across reboots
//   pm2 startup                      # enable boot startup (run the printed command)
//   pm2 logs / pm2 restart / pm2 status
//
// NODE_ENV=production keeps the /_dev dashboard OFF and security on. Other config
// (PORT, MONGO_URI, secrets) comes from your .env. CommonJS (.cjs) on purpose —
// the app itself is an ES module.
const pkg = require("./package.json");

module.exports = {
  apps: [
    {
      name: pkg.name || "app",
      script: "index.js",
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
