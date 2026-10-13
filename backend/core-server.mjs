import { timingSafeEqual } from 'node:crypto';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function respond(res, code, value) {
  res.writeHead(code, jsonHeaders);
  res.end(JSON.stringify(value));
}

/** Config fails closed: neither database nor API may accept external connections. */
export function checkConfig(env, token) {
  const bind = env.NCORE_BIND ?? '127.0.0.1';
  const port = Number(env.NCORE_PORT ?? '4765');
  const pgHost = env.PGHOST ?? '/var/run/postgresql';
  const pgPort = Number(env.PGPORT ?? '5432');
  const pgUser = env.PGUSER ?? 'neuralcore_api';
  const pgDatabase = env.PGDATABASE ?? 'neuralcore';
  if (bind !== '127.0.0.1') throw new Error('API may only bind 127.0.0.1 in canary mode');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API port');
  if (!pgHost.startsWith('/') || pgHost.includes('..') || pgHost.includes('\0')) throw new Error('Database must use a local Unix socket');
  if (!Number.isSafeInteger(pgPort) || pgPort < 1 || pgPort > 65535) throw new Error('Invalid PostgreSQL port');
  if (pgUser !== 'neuralcore_api' || pgDatabase !== 'neuralcore') throw new Error('Only the dedicated database identity is permitted');
  if (!/^[a-f0-9]{96}$/.test(token)) throw new Error('Expected a 48-byte random hex canary token in a root-managed file');
  return { bind, port, pgHost, pgPort, pgUser, pgDatabase };
}

export function validBearer(header, token) {
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([a-f0-9]{96})$/.exec(header);
  if (!match) return false;
  const a = Buffer.from(match[1], 'utf8');
  const b = Buffer.from(token, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only /healthz and authenticated /readyz exist in this canary. No memory reads or writes. */
export function makeHandler({ token, probe }) {
  return async function handler(req, res) {
    const addr = req.socket.remoteAddress;
    if (addr !== '127.0.0.1' && addr !== '::ffff:127.0.0.1') {
      return respond(res, 403, { error: 'Loopback only' });
    }
    let pathname;
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
    catch { return respond(res, 404, { error: 'Not found' }); }
    if (pathname !== '/healthz' && pathname !== '/readyz') return respond(res, 404, { error: 'Not found' });
    if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
    if (pathname === '/healthz') return respond(res, 200, { ok: true, service: 'neural-core', phase: 'local-only-canary' });
    if (!validBearer(req.headers.authorization, token)) return respond(res, 401, { error: 'Unauthorized' });
    try {
      await probe();
      return respond(res, 200, { ok: true, database: 'reachable', phase: 'local-only-canary' });
    } catch {
      return respond(res, 503, { ok: false, database: 'unavailable' });
    }
  };
}
