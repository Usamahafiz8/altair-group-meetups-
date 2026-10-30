import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createVerifier } from './auth.js';
import { createSql } from './db.js';
import { loadEnv } from './env.js';
import { createLogger } from './log.js';

const env = loadEnv();
const log = createLogger();
const sql = createSql(env.DATABASE_URL);
const app = createApp({ sql, verify: createVerifier(env.SUPABASE_URL), log });

// 0.0.0.0 so the Android emulator can reach it at 10.0.2.2.
const server = serve({ fetch: app.fetch, port: env.API_PORT, hostname: '0.0.0.0' }, (info) => {
  log.info('listening', { port: info.port });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void sql.end({ timeout: 5 }).finally(() => process.exit(0));
  });
}
