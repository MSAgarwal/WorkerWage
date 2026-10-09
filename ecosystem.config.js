module.exports = {
  apps: [
    {
      name: 'workerwage',
      script: './server.js',
      instances: 1, // Single instance ensures SQLite WAL serialized writes with high concurrent reads
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      }
    }
  ]
};
