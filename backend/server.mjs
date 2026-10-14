import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { checkConfig, makeHandler } from './core-server.mjs';
import { MemoryStore } from './memory-store.mjs';

const tokenPath = process.env.NCORE_TOKEN_FILE ?? '/etc/neural-core/api.token';
if (!tokenPath.startsWith('/') || tokenPath.includes('..')) throw new Error('Invalid token file path');
const token = readFileSync(tokenPath, 'utf8').trim();
const config = checkConfig(process.env, token);
const pool = new Pool({
  host: config.pgHost,
  port: config.pgPort,
  user: config.pgUser,
  database: config.pgDatabase,
  max: 2,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 12000,
  statement_timeout: 3000,
  query_timeout: 3000
});
const server = createServer(makeHandler({
  token,
  memoryEnabled: config.memoryEnabled,
  memoryStore: config.memoryEnabled ? new MemoryStore(pool, token) : null,
  probe: async () => {
    const result = await pool.query('SELECT 1 AS ready');
    if (result.rows[0]?.ready !== 1) throw new Error('Unready database');
  }
}));
server.maxConnections = 16;
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 3000;
server.listen(config.port, config.bind, () => {
  console.info('Neural Core local-only canary listening on loopback');
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const failsafe = setTimeout(() => process.exit(1), 8000).unref();
  server.close(async () => {
    try { await pool.end(); clearTimeout(failsafe); process.exit(0); }
    catch { process.exit(1); }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
