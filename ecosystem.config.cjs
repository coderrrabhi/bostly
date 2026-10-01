module.exports = {
  apps: [
    {
      name: 'boostlypro-api',
      script: './dist/index.mjs',
      cwd: '/opt/boostlypro/server',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        DATABASE_URL: 'postgres://boostly_user:BoostlySecure2026!@localhost:5432/boostlypro_db',
        SESSION_SECRET: 'b483e58c0db14a6da7c74fa0ec895df874620f3a6cf38914b10b06b2518e382b',
        PROVIDER_KEY_SECRET: 'c583e58c0db14a6da7c74fa0ec895df874620f3a6cf38914b10b06b2518e382c',
        DB_POOL_MAX: '15',
        WORKER_POOL_MAX: '6'
      }
    }
  ]
};
