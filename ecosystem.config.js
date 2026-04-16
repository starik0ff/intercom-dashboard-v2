// pm2 ecosystem for Intercom Dashboard v2.
// Two processes:
//   - intercom-dashboard-v2: Next.js production server on PORT=3100
//   - intercom-worker-v2:    incremental sync daemon (worker/run.ts)
// Both load env from .env.local via dotenv (app itself) or via env_file below.

module.exports = {
  apps: [
    {
      name: 'intercom-dashboard-v2',
      cwd: '/opt/intercom/intercom-dashboard-v2',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3100',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
      },
      error_file: '/opt/intercom/intercom-dashboard-v2/logs/web.err.log',
      out_file: '/opt/intercom/intercom-dashboard-v2/logs/web.out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'intercom-worker-v2',
      cwd: '/opt/intercom/intercom-dashboard-v2',
      script: 'node_modules/.bin/tsx',
      args: 'worker/run.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        SYNC_INTERVAL_MINUTES: '15',
      },
      error_file: '/opt/intercom/intercom-dashboard-v2/logs/worker.err.log',
      out_file: '/opt/intercom/intercom-dashboard-v2/logs/worker.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
